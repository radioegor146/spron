import 'dotenv/config'
import { createClient } from '@spron/database'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { getLogger } from '@spron/utils'
import { compile, TemplateDelegate } from 'handlebars'
import { readFileSync } from 'node:fs'
import OpenAI from 'openai'

import { getEnvironment } from './environment.js'

const logger = getLogger()

const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const openai = new OpenAI({
  apiKey: environment.OPENAI_API_KEY,
  baseURL: environment.OPENAI_BASE_URL
})

await prisma.$connect()

interface MediaWithEmbedding {
  description: null | string
  embedding: string
  hasEmbedding: boolean
  id: string
  tagsSet: boolean
}

interface TagResult {
  id: string
  score: number
}

interface TagWithSimilarity {
  description: string
  id: string
  name: string
  similarity: number
}

function createTemplate (path: string): TemplateDelegate {
  return compile(readFileSync(path).toString('utf8'), {
    noEscape: true
  })
}

const imageTemplate = createTemplate(environment.PROMPT_IMAGE_TEMPLATE_GET_TAGS_PATH)
const videoTemplate = createTemplate(environment.PROMPT_IMAGE_TEMPLATE_GET_TAGS_PATH)

async function getTags (description: string, vector: number[], type: 'image' | 'video'): Promise<TagResult[]> {
  const nearestTags = await prisma.$queryRaw<TagWithSimilarity[]>`select id, name, description, (1 - (embedding <=> ${
    JSON.stringify(vector)}::vector)) as 'similarity' order by 'similarity' desc limit ${
      environment.NUMBER_OF_TOP_TAGS_TO_SUGGEST}`

  const template = type === 'image' ? imageTemplate : videoTemplate
  const text = template({
    description,
    tags: nearestTags.toSorted((a, b) => b.similarity - a.similarity)
  })

  const response = await openai.chat.completions.create({
    messages: [{
      content: [{
        text,
        type: 'text'
      }],
      role: 'user'
    }],
    model: environment.OPENAI_MODEL_NAME
  })

  const firstResponse = response.choices[0]?.message?.content
  if (!firstResponse) {
    throw new Error('failed to get response from LLM')
  }

  const resultTags = new Set(JSON.parse(firstResponse) as string[])

  const result: TagResult[] = []

  for (const tag of nearestTags) {
    if (resultTags.has(tag.id)) {
      result.push({
        id: tag.id,
        score: tag.similarity
      })
    }
  }

  return result
}

async function processImage (imageId: string): Promise<boolean> {
  const images = await prisma.$queryRaw<MediaWithEmbedding[]>`select id, description, (embedding is not null) as 'hasEmbedding', embedding::string as 'embedding', tagsSet from Image where id = ${imageId}`
  const image = images[0]

  if (!image) {
    logger.warn(`image '${imageId}' not found`)
    return false
  }

  if (image.description === null) {
    logger.warn(`image '${imageId}' does not have description`)
    return true
  }

  if (!image.hasEmbedding) {
    logger.warn(`image '${imageId}' does not have embedding`)
    return true
  }

  if (image.tagsSet) {
    logger.warn(`image '${imageId}' already has tags set`)
    return true
  }

  const tags = await getTags(image.description, JSON.parse(image.embedding), 'image')

  await prisma.imageTag.createMany({
    data: tags.map(tag => ({
      imageId,
      score: tag.score,
      tagId: tag.id
    }))
  })
  await prisma.image.update({
    data: {
      tagsSet: true
    },
    where: {
      id: imageId
    }
  })

  return true
}

async function processVideo (videoId: string): Promise<boolean> {
  const videos = await prisma.$queryRaw<MediaWithEmbedding[]>`select id, description, (embedding is not null) as 'hasEmbedding', embedding::string as 'embedding', tagsSet from Video where id = ${videoId}`
  const video = videos[0]

  if (!video) {
    logger.warn(`video '${videoId}' not found`)
    return false
  }

  if (video.description === null) {
    logger.warn(`video '${videoId}' does not have description`)
    return true
  }

  if (!video.hasEmbedding) {
    logger.warn(`video '${videoId}' does not have embedding`)
    return true
  }

  if (video.tagsSet) {
    logger.warn(`video '${videoId}' already has tags set`)
    return true
  }

  const tags = await getTags(video.description, JSON.parse(video.embedding), 'video')

  await prisma.videoTag.createMany({
    data: tags.map(tag => ({
      score: tag.score,
      tagId: tag.id,
      videoId
    }))
  })
  await prisma.video.update({
    data: {
      tagsSet: true
    },
    where: {
      id: videoId
    }
  })

  return true
}

const enricher = createEnricher(environment, {
  [EnricherJobName.ENRICH_IMAGE]: processImage,
  [EnricherJobName.ENRICH_VIDEO]: processVideo
})

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
