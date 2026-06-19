// Vitest globalSetup: 테스트 실행 전 1회만 실행.
// 다음 커밋에서 DATABASE_URL_TEST 기반 DB 생성 + 마이그레이션 적용 예정.
export default async function globalSetup(): Promise<void> {
  // TODO: implement test DB provisioning
}
