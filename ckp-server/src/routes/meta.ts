/**
 * GET /v1/meta (인증 불필요) — 서버 버전·데이터 출처·기능 플래그·제한값
 */
import type { FastifyInstance } from 'fastify';
import type { RouteOptions } from '../app.js';
import { API_VERSION, type MetaResponse } from '../contract.js';
import { nowKst } from '../lib/kst.js';
import { ediLimits } from '../lib/limits.js';

export default async function metaRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { config, capabilities, clock, storage, dataSource } = opts.deps;

  app.get('/', async (): Promise<MetaResponse> => ({
    apiVersion: API_VERSION,
    dataSource,
    storage: storage.driver,
    serverTime: nowKst(clock.now()),
    features: {
      clientApprovalRequiredForEdi: config.features.clientApprovalRequiredForEdi,
      clientTypeField: capabilities.clientHospitalType,
      medicineFeeVisible: config.features.medicineFeeVisible && capabilities.freesTable && capabilities.medicineTaxColumns.length > 0,
      selfRegistration: config.registration.enabled,
    },
    limits: ediLimits(config),
  }));
}
