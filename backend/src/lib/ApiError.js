/* 의도된 에러(4xx)와 예기치 못한 에러(5xx)를 구분하기 위한 클래스.
 * 기존 server.js 는 모든 예외를 500 + error.message 로 내려보내서
 * "잘못된 입력"과 "서버 장애"를 프론트가 구분할 수 없었다. */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static notFound(message = '대상을 찾을 수 없습니다.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
}

module.exports = ApiError;
