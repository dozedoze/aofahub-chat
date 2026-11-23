import { resizeUploadImage } from '../../utils/resizeUploadImage.js'
import type { FileAttachment } from './types.js'

/** 内联进请求的附件：图片走 vision，文本拼进正文，其它文件带上文件名。 */
export type FilePayload =
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'text'; text: string }

const MAX_TEXT_CHARS = 200_000

const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const imageMediaType = (mimeType: string) => (IMAGE_MEDIA.has(mimeType) ? mimeType : 'image/png')

export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Cannot read file'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Cannot read file'))
    reader.readAsDataURL(blob)
  })

const readUtf8IfText = async (blob: Blob): Promise<string | null> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.includes(0)) {
    return null
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const replacement = (text.match(/\uFFFD/g) ?? []).length
  if (bytes.length > 0 && replacement / bytes.length > 0.05) {
    return null
  }
  return text
}

const clipText = (text: string) =>
  text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…` : text

export const encodeFilePayload = async (
  file: FileAttachment,
  blob: Blob,
  signal: AbortSignal
): Promise<FilePayload> => {
  signal.throwIfAborted()
  if (file.isImage) {
    const source =
      blob instanceof File
        ? blob
        : new File([blob], file.name, { type: file.mimeType || blob.type })
    const ready = await resizeUploadImage(source, signal)
    return {
      type: 'image',
      mediaType: imageMediaType(ready.type || file.mimeType),
      data: await blobToBase64(ready),
    }
  }
  const text = await readUtf8IfText(blob)
  signal.throwIfAborted()
  if (text !== null) {
    return { type: 'text', text: `\n\n[${file.name}]\n${clipText(text)}` }
  }
  return { type: 'text', text: `\n\n[${file.name}]` }
}
