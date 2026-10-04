/** 샘플 공지사항 (서버가 sanitize 한 결과와 같은 허용 태그만 사용) */
import type { NoticeDetail } from '../contract';

interface NoticeSeed {
  title: string;
  regYmd: string;
  important?: boolean;
  author?: string;
  html?: string;
}

const EDI_GUIDE_HTML = `<h2>EDI 사진 등록 방법</h2>
<p>앱에서 처방·거래 증빙 사진을 등록하는 순서를 안내드립니다.</p>
<ol>
<li><strong>기본 정보</strong>: 거래처와 대상 연월(당월·전월·전전월)을 선택합니다.</li>
<li><strong>사진 선택</strong>: 앨범에서 여러 장을 한 번에 고르거나 카메라로 촬영합니다. 한 번에 최대 <strong>30장</strong>까지 등록할 수 있습니다.</li>
<li><strong>순서 확인</strong>: 사진을 길게 눌러 끌거나 앞/뒤 버튼으로 순서를 바꿉니다. 등록한 순서대로 관리자 화면에 표시됩니다.</li>
<li><strong>등록</strong>: 모든 사진이 업로드된 뒤 등록이 완료됩니다. 실패한 사진만 다시 보낼 수 있습니다.</li>
</ol>
<blockquote>글자가 잘 보이도록 밝은 곳에서 문서 전체가 나오게 촬영해 주세요.</blockquote>
<p>문의: <a href="mailto:support@example.com">support@example.com</a></p>`;

const CLOSING_HTML = (month: string, day: string) => `<p>${month} EDI 마감 일정을 안내드립니다.</p>
<table>
<thead><tr><th>구분</th><th>마감일</th><th>비고</th></tr></thead>
<tbody>
<tr><td>당월 EDI 등록</td><td>${day}</td><td>18:00까지</td></tr>
<tr><td>누락분 추가 등록</td><td>마감 후 3영업일</td><td>담당자 확인 필요</td></tr>
<tr><td>정산 확정</td><td>익월 10일</td><td>-</td></tr>
</tbody>
</table>
<p>마감 이후 등록분은 <strong>다음 달 정산</strong>에 반영됩니다.</p>`;

const HOLIDAY_HTML = `<p>연휴 기간 동안 고객 지원과 정산 업무가 아래와 같이 조정됩니다.</p>
<ul>
<li>고객 지원: 연휴 기간 휴무 (앱 이용은 가능합니다)</li>
<li>EDI 검토: 연휴 이후 첫 영업일부터 순차 진행</li>
<li>정산 지급일: <strong>2영업일 순연</strong></li>
</ul>
<p>이용에 참고 부탁드립니다.</p>`;

const NEW_ITEMS_HTML = `<p>이번 달 신규 등록 품목을 안내드립니다. 자세한 약가와 수수료는 의약품 메뉴에서 확인해 주세요.</p>
<ul>
<li>리피온정 10mg · 20mg · 40mg</li>
<li>로수엔정 5mg · 10mg</li>
<li>시타원필름코팅정 50mg · 100mg</li>
</ul>
<p><em>품목별 공급 일정은 제약사 사정에 따라 달라질 수 있습니다.</em></p>`;

const APP_UPDATE_HTML = `<h3>CKP 업무 앱 개선 사항</h3>
<ul>
<li>EDI 사진 순서 바꾸기(끌어서 이동, 앞/뒤 버튼) 지원</li>
<li>업로드 실패 사진만 다시 보내기</li>
<li>넓은 화면(PC 웹)에서 좌측 메뉴 제공</li>
</ul>
<p>앱을 최신 버전으로 업데이트해 주세요.</p>
<hr>
<p>웹 주소: <a href="https://example.com">https://example.com</a></p>`;

const PRIVACY_HTML = `<p>개인정보 처리방침이 개정되어 안내드립니다.</p>
<p><strong>주요 변경 내용</strong></p>
<ul>
<li>EDI 증빙 사진의 보관 기간 명시 (정산 확정 후 5년)</li>
<li>사진 업로드 시 위치 정보 등 메타데이터 자동 삭제</li>
</ul>
<p>시행일: 2026년 10월 1일</p>`;

const GENERIC_HTML = (topic: string) => `<p>${topic} 관련 안내입니다.</p>
<p>세부 내용은 담당 영업 관리자에게 문의해 주세요. 공지 내용은 사정에 따라 변경될 수 있습니다.</p>
<p>전화 문의: <a href="tel:0212345678">02-1234-5678</a></p>`;

const SEEDS: NoticeSeed[] = [
  { title: '[필독] 2026년 9월 EDI 마감 일정 안내', regYmd: '2026-09-01', important: true, html: CLOSING_HTML('9월', '2026-09-30') },
  { title: '[필독] 앱으로 EDI 사진 등록하는 방법', regYmd: '2026-08-20', important: true, html: EDI_GUIDE_HTML },
  { title: '추석 연휴 고객 지원 및 정산 일정 안내', regYmd: '2026-09-15', important: true, html: HOLIDAY_HTML },
  { title: 'CKP 업무 앱 업데이트 안내 (v1.0)', regYmd: '2026-09-24', html: APP_UPDATE_HTML },
  { title: '9월 신규 등록 품목 안내', regYmd: '2026-09-10', html: NEW_ITEMS_HTML },
  { title: '개인정보 처리방침 개정 안내', regYmd: '2026-09-05', html: PRIVACY_HTML },
  { title: '8월 EDI 마감 일정 안내', regYmd: '2026-08-01', html: CLOSING_HTML('8월', '2026-08-31') },
  { title: '거래처 등록 시 사업자등록번호 확인 절차 안내', regYmd: '2026-07-28' },
  { title: '8월 신규 등록 품목 안내', regYmd: '2026-08-08', html: NEW_ITEMS_HTML },
  { title: '여름 휴가 기간 정산 일정 안내', regYmd: '2026-07-20', html: HOLIDAY_HTML },
  { title: '7월 EDI 마감 일정 안내', regYmd: '2026-07-01', html: CLOSING_HTML('7월', '2026-07-31') },
  { title: '수수료 정책 변경 사전 안내', regYmd: '2026-06-25' },
  { title: '거래처 승인 절차 안내', regYmd: '2026-06-18' },
  { title: '6월 EDI 마감 일정 안내', regYmd: '2026-06-01', html: CLOSING_HTML('6월', '2026-06-30') },
  { title: '의약품 약가 변동 반영 안내', regYmd: '2026-05-27' },
  { title: '영업 담당자 교육 일정 안내', regYmd: '2026-05-15' },
  { title: '5월 EDI 마감 일정 안내', regYmd: '2026-05-01', html: CLOSING_HTML('5월', '2026-05-29') },
  { title: '서비스 점검 안내 (4월 26일 새벽)', regYmd: '2026-04-22' },
  { title: '4월 EDI 마감 일정 안내', regYmd: '2026-04-01', html: CLOSING_HTML('4월', '2026-04-30') },
  { title: '정산 명세서 발송 방식 변경 안내', regYmd: '2026-03-20' },
  { title: '3월 EDI 마감 일정 안내', regYmd: '2026-03-02', html: CLOSING_HTML('3월', '2026-03-31') },
  { title: '2026년 상반기 업무 협조 요청', regYmd: '2026-02-10' },
  { title: '설 연휴 정산 일정 안내', regYmd: '2026-02-05', html: HOLIDAY_HTML },
  { title: 'CKP 영업 지원 시스템 오픈 안내', regYmd: '2026-01-05' },
];

export const SAMPLE_NOTICES: NoticeDetail[] = SEEDS.map((seed, i) => ({
  idx: 1000 + (SEEDS.length - i),
  title: seed.title,
  author: seed.author ?? '관리자',
  regYmd: seed.regYmd,
  important: !!seed.important,
  contentHtml: seed.html ?? GENERIC_HTML(seed.title.replace(/^\[[^\]]+\]\s*/u, '')),
  attachments: [],
}));
