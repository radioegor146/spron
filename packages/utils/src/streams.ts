import { Readable } from 'node:stream'

export function getAsBase64Data (buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function getAsBuffer (stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const buffers: Buffer[] = []
    stream.on('data', data => {
      buffers.push(data)
    })
    stream.on('error', error => {
      reject(error)
    })
    stream.on('end', () => {
      resolve(Buffer.concat(buffers))
    })
  })
}
