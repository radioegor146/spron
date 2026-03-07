import 'dotenv/config'
import { node } from '@elysiajs/node'
import { embeddorRequestType, embeddorResponseType } from '@spron/embeddor-api'
import { getLogger } from '@spron/utils'
import { Elysia } from 'elysia'
import { OpenAI } from 'openai/client.js'

import { getEnvironment } from './environment.js'

const logger = getLogger()
const environment = getEnvironment()

const server = new Elysia({
  adapter: node()
})

const openai = new OpenAI({
  apiKey: environment.OPENAI_API_KEY,
  baseURL: environment.OPENAI_BASE_URL
})

server.post('/', async ({ body }) => {
  const embeddings = await openai.embeddings.create({
    input: body.text,
    model: environment.OPENAI_MODEL_NAME
  })
  const vector = embeddings.data[0]?.embedding
  if (!vector) {
    throw new Error('failed to get embeddings')
  }

  return {
    vector
  }
}, {
  body: embeddorRequestType,
  response: embeddorResponseType
})

server.listen(environment.PORT, () => {
  logger.info('started')
})
