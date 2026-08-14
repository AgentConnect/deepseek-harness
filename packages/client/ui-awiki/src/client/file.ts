/** Browser attachment byte conversion and download helpers. */

import type { AwikiDownloadedAttachment } from '@deepseek-ai/dsh-awiki/types'

/**
 * Read one browser file as base64 without retaining the bytes after settlement.
 * @param file - selected browser file.
 * @returns base64 payload without a data-URL prefix.
 */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/**
 * Offer verified Host-returned bytes as a browser download.
 * @param value - attachment metadata and base64 bytes returned by the Host.
 */
export function saveDownloadedAttachment(value: AwikiDownloadedAttachment): void {
  const binary = atob(value.bytesBase64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: value.attachment.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = value.attachment.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
