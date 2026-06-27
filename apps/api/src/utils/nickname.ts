import { randomUUID } from "node:crypto";

/** 신규 유저용 닉네임 생성: `user_<uuid 앞 8자리>`. */
export function generateRandomNickname(): string {
  return `user_${randomUUID().slice(0, 8)}`;
}
