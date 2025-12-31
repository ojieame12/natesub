export function getErrorInfo(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  return { name: undefined, message: typeof error === 'string' ? error : 'Unknown error' }
}
