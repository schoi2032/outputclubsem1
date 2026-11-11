export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Sign in to continue') =>
  new AppError(401, 'unauthorized', message)
export const forbidden = (message = "You don't have permission to do that") =>
  new AppError(403, 'forbidden', message)
/** Also used to hide the existence of resources the caller may not see. */
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`)
export const conflict = (message: string) => new AppError(409, 'conflict', message)
export const tooLarge = (message: string) => new AppError(413, 'payload_too_large', message)
export const unprocessable = (message: string) => new AppError(422, 'unprocessable', message)
export const notImplemented = (message: string) => new AppError(501, 'not_implemented', message)
