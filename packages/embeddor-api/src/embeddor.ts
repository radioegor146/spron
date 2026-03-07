import z from 'zod'

export const embeddorRequestType = z.object({
  text: z.string()
})

export type EmbeddorRequest = z.infer<typeof embeddorRequestType>

export const embeddorResponseType = z.object({
  vector: z.array(z.number())
})

export type EmbeddorResponse = z.infer<typeof embeddorResponseType>

export class EmbeddorAPI {
  constructor (private readonly baseUrl: string) {}

  async getEmbeddings (text: string): Promise<number[]> {
    const response = await fetch(this.baseUrl, {
      body: JSON.stringify({
        text
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    const json = await response.json()
    return embeddorResponseType.parse(json).vector
  }
}
