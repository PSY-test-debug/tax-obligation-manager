/* async 라우트 핸들러의 예외를 Express 에러 핸들러로 넘긴다.
 * 이게 없으면 async 함수 안의 throw 가 그대로 unhandled rejection 이 되고
 * 클라이언트는 응답 없이 타임아웃된다. (기존 코드의 try/catch 반복을 제거) */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
