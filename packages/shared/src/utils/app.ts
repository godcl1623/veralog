export const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name}이(가) 설정되지 않았습니다. .env 파일을 확인해주세요.`
    );
  }
  return value;
};
