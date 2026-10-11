/**
 * Starts a browser download for a response body without retaining an object URL.
 *
 * Keeping this lifecycle in one place is important for generated exports: object
 * URLs hold their Blob in memory until they are explicitly revoked.
 */
export async function downloadResponse(response: Response, filename: string): Promise<void> {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  try {
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
