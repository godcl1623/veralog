-- Veralog 테스트 DB 부트스트랩 스크립트
--
-- 목적: 테스트 전용 DB(`veralog_test`)와 전용 user(`veralog_test`)를 1회 생성한다.
--
-- 실행:
--   psql "${DATABASE_URL_TEST_ADMIN}" -f apps/api/scripts/setup-test-db.sql
--
-- 주의:
--   * .env의 DATABASE_URL_TEST_ADMIN 자격(admin)으로 실행할 것.
--   * 운영 DB가 아닌 로컬 Postgres를 가정한다.
--   * 본 스크립트는 멱등(idempotent)하다. 재실행해도 안전하다.

-- 1. 기존 리소스 정리 (재실행 대비)
DROP DATABASE IF EXISTS veralog_test;
DROP ROLE IF EXISTS veralog_test;

-- 2. 전용 role 생성
--    테스트 코드는 본 자격만 사용한다. 운영 admin 자격증명은 본 스크립트 외에 어디에도 두지 않는다.
CREATE ROLE veralog_test WITH LOGIN PASSWORD 'veralog_test';

-- 3. 전용 DB 생성 (veralog_test user가 owner)
--    DB owner는 자동으로 public 스키마 owner가 되므로 (PostgreSQL 15+),
--    별도 GRANT ON SCHEMA public 없이도 CREATE TABLE이 가능하다.
CREATE DATABASE veralog_test OWNER veralog_test;
