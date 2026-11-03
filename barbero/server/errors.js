/** An error that is safe to show to the client. Everything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(status, code, message = code, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code = 'invalid_input', extra) => new HttpError(400, code, code, extra);
export const unauthorized = (code = 'unauthorized') => new HttpError(401, code);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code) => new HttpError(409, code);
