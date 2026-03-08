import z from 'zod'

export const perceptionResponseType = z.object({
  vector: z.array(z.number())
})

export type PerceptionResponse = z.infer<typeof perceptionResponseType>

export class PerceptionAPI {
  constructor (private readonly baseUrl: string) {}

  async getEmbeddings (image: Buffer): Promise<number[]> {
    const response = await fetch(this.baseUrl, {
      body: new Uint8Array(image),
      headers: {
        'content-type': 'image/jpeg'
      },
      method: 'POST'
    })
    const json = await response.json()
    return perceptionResponseType.parse(json).vector
  }
}
