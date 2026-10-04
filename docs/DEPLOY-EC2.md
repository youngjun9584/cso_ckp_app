# CKP API 서버 — AWS EC2 배포 (직접 실행 방식)

Docker 없이 EC2 한 대에 Node 24 + systemd + Nginx(HTTPS) 로 올리는 절차다. 이 구성이 가장 단순하고 비용이 적다.
구성: `인터넷 → (443) Nginx → (127.0.0.1:4000) Node ckp-server → RDS cso_ckp / S3 edi-img`

> 사전 확인된 사실
> - RDS `database-1.c5gx6m1iccdy.ap-northeast-2.rds.amazonaws.com` 은 **공인 IP 로 풀린다**(15.165.98.58). EC2 가 다른 VPC 에 있어도 RDS 보안 그룹만 열면 접속된다.
> - 서버는 `0.0.0.0:4000` 으로 뜨고, `/healthz` 가 있고, SIGTERM 으로 깔끔히 종료된다(systemd 와 잘 맞음).
> - `sharp`(이미지 처리)는 OS 별 바이너리를 쓴다. **반드시 EC2(리눅스)에서 `npm ci`** 한다. 윈도우의 `node_modules` 를 복사하면 안 된다. 리눅스 x64 용 바이너리(`@img/sharp-linux-x64`)가 npm 에서 자동으로 받아지므로 별도 컴파일러는 필요 없다.

---

## 1. EC2 만들기 (AWS 콘솔)

| 항목 | 값 |
|---|---|
| 리전 | 아시아 태평양(서울) `ap-northeast-2` — RDS·S3 와 같은 리전(지연·전송비 최소) |
| AMI | **Amazon Linux 2023** (64-bit x86) |
| 인스턴스 유형 | `t3.small` (2 vCPU, 2 GB) — 사진 처리(sharp) 때문에 `t3.micro`(1 GB)는 메모리 부족 위험. 사용자가 많으면 `t3.medium` |
| 스토리지 | gp3 20 GB |
| 키 페어 | 새로 생성(.pem 다운로드, 분실 시 접속 불가) |
| 보안 그룹(인바운드) | `22` SSH — 내 IP 만 / `80` HTTP — 0.0.0.0/0 / `443` HTTPS — 0.0.0.0/0. **4000 은 열지 않는다**(Nginx 뒤에 숨김) |
| 탄력적 IP | 할당 후 인스턴스에 연결(재부팅해도 IP 유지 → DNS·RDS 보안 그룹에 고정 IP 사용) |

### RDS 보안 그룹 열기 (필수, 안 하면 서버가 DB 에 못 붙음)
RDS 콘솔 → `database-1` → 보안 그룹 → 인바운드 규칙 추가:
`PostgreSQL / TCP 5432 / 소스 = EC2 의 탄력적 IP/32` (같은 VPC 면 EC2 보안 그룹 ID 를 소스로 지정해도 된다).

### DNS
도메인 관리(Route 53 등)에서 `A 레코드: api.ckp.co.kr → 탄력적 IP`. Let's Encrypt 인증서 발급 전에 DNS 가 먼저 퍼져 있어야 한다.

---

## 2. 접속 및 기본 설치

```bash
# 내 PC 에서 (PowerShell)
ssh -i ckp-key.pem ec2-user@<탄력적 IP>
```

```bash
# EC2 안에서
sudo dnf update -y
sudo dnf install -y git nginx

# Node 24 (NodeSource)
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs
node -v            # v24.x 확인 (package.json engines: node >=24)
```

---

## 3. 코드 올리기

이 프로젝트는 아직 git 저장소가 아니다. 두 방법 중 하나:

**방법 A — 파일 직접 복사 (지금 바로 가능)**
```powershell
# 내 PC PowerShell, cso_ckp_app 폴더에서. node_modules/.env/.data/dist 는 제외
tar --exclude=node_modules --exclude=.env --exclude=.data --exclude=dist -czf ckp-server.tgz ckp-server
scp -i ckp-key.pem ckp-server.tgz ec2-user@<탄력적 IP>:~/
```
```bash
# EC2
sudo mkdir -p /opt/ckp && sudo chown ec2-user:ec2-user /opt/ckp
tar -xzf ~/ckp-server.tgz -C /opt/ckp
```

**방법 B — git (권장, 이후 업데이트가 쉬움)**
`cso_ckp_app` 을 GitHub/GitLab 비공개 저장소에 올린 뒤 EC2 에서 `git clone` → `/opt/ckp/ckp-server`.
`.env` 는 절대 커밋하지 않는다(`.gitignore` 에 이미 있음).

---

## 4. 빌드

```bash
cd /opt/ckp/ckp-server
npm ci                 # 리눅스용 sharp 바이너리가 여기서 받아진다
npm run build          # → dist/
ls dist/index.js       # 있으면 OK
```

---

## 5. 운영 환경변수

```bash
cp .env.example .env
chmod 600 .env         # 다른 사용자가 못 읽게
nano .env
```

아래 값으로 채운다. **비밀키 2개는 아래 명령으로 생성**한다(각각 실행, 서로 다른 값):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```dotenv
NODE_ENV=production
HOST=127.0.0.1                      # Nginx 뒤에만 노출 (외부에서 4000 직접 접근 차단)
PORT=4000
DATABASE_URL=postgres://<앱계정>:<비밀번호>@database-1.c5gx6m1iccdy.ap-northeast-2.rds.amazonaws.com:5432/cso_ckp?sslmode=require
DATABASE_SSL=                       # 비워 두면 URL 의 sslmode=require 를 따른다
JWT_SECRET=<생성값 1>
FILE_TOKEN_SECRET=<생성값 2>
CORS_ORIGINS=https://app.ckp.co.kr  # 웹 앱 도메인 (정확히 일치해야 웹 로그인 유지)
COOKIE_SECURE=true
TRUST_PROXY=1                       # Nginx 1대. 'true' 는 운영에서 기동 거부됨
PUBLIC_BASE_URL=https://api.ckp.co.kr
STORAGE_DRIVER=s3
S3_BUCKET=edi-img
S3_REGION=ap-northeast-2
S3_KEY_PREFIX=uploads/users/ckp
AWS_ACCESS_KEY_ID=                  # ※ EC2 에 IAM 역할을 붙이면 비워 둔다 (아래 참고)
AWS_SECRET_ACCESS_KEY=
LEGACY_IMAGE_URL_PREFIXES=https://edi-img.s3.ap-northeast-2.amazonaws.com/
SELF_REGISTRATION_ENABLED=true      # 회원가입 접수 안 받으면 false
```

> **S3 자격 증명 — IAM 역할 방식 권장.** EC2 에 IAM 역할(인스턴스 프로파일)을 붙이면 키를 파일에 적지 않아도 된다(AWS SDK 가 자동 인식).
> IAM 콘솔 → 역할 만들기 → EC2 → 아래 인라인 정책 → 역할을 인스턴스에 연결(작업 → 보안 → IAM 역할 수정).
> ```json
> {"Version":"2012-10-17","Statement":[{"Effect":"Allow",
>   "Action":["s3:PutObject","s3:GetObject","s3:DeleteObject"],
>   "Resource":"arn:aws:s3:::edi-img/uploads/users/ckp/*"}]}
> ```
> 역할을 못 쓰면 이 권한만 가진 IAM 사용자의 액세스 키를 `.env` 에 넣는다(참고 프로젝트의 기존 키는 재사용하지 않는다).

### 기동 전 점검
```bash
npm run db:check                   # RDS 접속 + 스키마 읽기 전용 점검. 여기서 실패하면 보안 그룹/계정 문제
npm run db:migrate                 # 적용 계획만 출력
npm run db:migrate -- --yes        # 앱 전용 테이블 적용 (백업 후, 1회)
NODE_ENV=production node dist/index.js   # 한 번 직접 띄워 본다 → "CKP API 서버 시작" 로그 확인 후 Ctrl+C
```
운영 모드는 필수값 누락·개발용 키·`TRUST_PROXY=true` 가 있으면 **기동을 거부**하고 한국어로 이유를 출력한다.

---

## 6. systemd 로 상시 실행 (재부팅·크래시 자동 복구)

```bash
sudo tee /etc/systemd/system/ckp-server.service > /dev/null <<'EOF'
[Unit]
Description=CKP API server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/ckp/ckp-server
EnvironmentFile=/opt/ckp/ckp-server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20
# 로그는 journald 로
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ckp-server
sudo systemctl status ckp-server          # active (running) 확인
curl -s http://127.0.0.1:4000/healthz     # {"ok":true}
curl -s http://127.0.0.1:4000/v1/meta     # "dataSource":"production"
```

로그 보기: `sudo journalctl -u ckp-server -f` (시작 시 "DB 스키마 확인 결과" 가 한국어로 찍힌다. `앱 전용 테이블: 있음` 확인)

---

## 7. Nginx + HTTPS (Let's Encrypt)

```bash
sudo tee /etc/nginx/conf.d/ckp-api.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name api.ckp.co.kr;

    # 사진 업로드 허용 크기 (서버 PHOTO_MAX_BYTES 15MB 보다 약간 크게)
    client_max_body_size 20m;

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;      # 30장 업로드·이미지 처리 여유
    }
}
EOF
sudo nginx -t && sudo systemctl enable --now nginx
```

HTTPS 인증서 (DNS 가 EC2 IP 를 가리킨 뒤 실행):
```bash
sudo dnf install -y python3-certbot-nginx     # 없으면: sudo dnf install -y python3-pip && sudo pip3 install certbot certbot-nginx
sudo certbot --nginx -d api.ckp.co.kr         # 이메일 입력, 약관 동의 → 자동으로 443 설정 + HTTP→HTTPS 리다이렉트
sudo systemctl status certbot-renew.timer     # 자동 갱신 타이머 확인
```

확인:
```bash
curl -s https://api.ckp.co.kr/v1/meta
```
`X-Forwarded-Proto https` 가 넘어가므로 서버의 `COOKIE_SECURE=true` 쿠키가 정상 동작하고, `TRUST_PROXY=1` 덕분에 로그인 시도 제한이 실제 사용자 IP 기준으로 걸린다.

---

## 8. 정기 작업 (cron)

```bash
crontab -e
```
```
# 매일 04:00 미사용 업로드 정리 (24시간 지난 PENDING) — 빌드된 dist 파일을 직접 실행
0 4 * * * cd /opt/ckp/ckp-server && /usr/bin/node --env-file=.env dist/scripts/cleanup-uploads.js --apply >> /var/log/ckp-cleanup.log 2>&1
```
`npm run build` 가 `dist/scripts/` 에 `cleanup-uploads.js`, `db-check.js`, `db-migrate.js` 를 함께 만들어 두므로 운영에서는 `tsx` 없이 이 파일들을 바로 쓴다.
먼저 한 번 수동으로 dry-run: `node --env-file=.env dist/scripts/cleanup-uploads.js` (대상 목록만 출력).

---

## 9. 업데이트 배포 (코드 바뀌었을 때)

```bash
cd /opt/ckp/ckp-server
# 방법 A: 새 tgz 를 scp 로 올린 뒤 덮어쓰기 / 방법 B: git pull
npm ci && npm run build
npm run db:migrate           # 새 마이그레이션이 있는지 확인 (있으면 -- --yes)
sudo systemctl restart ckp-server
curl -s http://127.0.0.1:4000/healthz
```
`.env` 는 시작할 때 한 번만 읽으므로 값을 바꾸면 반드시 `restart` 한다.

---

## 10. 문제 해결

| 증상 | 확인 |
|---|---|
| `db:check` 에서 접속 실패/타임아웃 | RDS 보안 그룹에 EC2 탄력적 IP 가 없음. `nc -zv database-1....amazonaws.com 5432` 로 포트 확인 |
| 기동 거부 + 한국어 오류 | `.env` 필수값·`TRUST_PROXY=true`·개발용 키. 메시지대로 수정 |
| 웹에서 로그인 직후 풀림 | `CORS_ORIGINS` 가 웹 도메인과 다름 (https 포함 정확히) |
| 사진이 안 보임 | `LEGACY_IMAGE_URL_PREFIXES` 비어 있음 / S3 IAM 권한 / `docs/OPERATIONS.md` §4-1 담당자 매칭 |
| 업로드 413 | Nginx `client_max_body_size` 확인 |
| 메모리 부족으로 죽음 | `journalctl` 에 OOM → `t3.medium` 으로 상향 |
| 502 Bad Gateway | `systemctl status ckp-server` — 서버가 죽었거나 `HOST`/`PORT` 불일치 |

---

## 11. 비용 (서울 리전, 대략)
- `t3.small` 온디맨드 약 $19/월(약 2.6만원), 1년 예약 시 약 40% 절감
- 탄력적 IP: 인스턴스에 연결된 동안 시간당 $0.005 (월 약 $3.6)
- 데이터 전송: 사진 다운로드량에 비례, 소규모면 월 수천원
