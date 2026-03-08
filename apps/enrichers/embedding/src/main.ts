import 'dotenv/config'
import { createClient } from '@spron/database'
import { EmbeddorAPI } from '@spron/embeddor-api'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { getLogger } from '@spron/utils'

import { getEnvironment } from './environment.js'

const logger = getLogger()
const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const embeddor = new EmbeddorAPI(environment.EMBEDDOR_BASE_URL)

await prisma.$connect()

interface MediaWithHasEmbedding {
  description: null | string
  hasEmbedding: boolean
  id: string
}

interface PostWithHasEmbedding {
  hasEmbedding: boolean
  id: string
  textContent: null | string
}

async function processImage (imageId: string): Promise<boolean> {
  const imagesWithHasEmbedding = await prisma.$queryRaw<MediaWithHasEmbedding[]>`select id, (embedding is not null) as 'hasEmbedding', description from Image where id = ${imageId}`
  const imageWithHasEmbedding = imagesWithHasEmbedding[0]

  if (!imageWithHasEmbedding) {
    logger.warn(`image '${imageId}' not found`)
    return false
  }

  if (imageWithHasEmbedding.hasEmbedding) {
    logger.warn(`image '${imageId}' already has embedding`)
    return true
  }

  if (!imageWithHasEmbedding.description) {
    logger.warn(`image '${imageId}' does not have description`)
    return true
  }

  const embedding = await embeddor.getEmbeddings(imageWithHasEmbedding.description)

  await prisma.$executeRaw`update Image set embedding = ${JSON.stringify(embedding)}::vector where id = ${imageId}`

  return true
}

async function processPost (postId: string): Promise<boolean> {
  const postsWithHasEmbedding = await prisma.$queryRaw<PostWithHasEmbedding[]>`select id, (embedding is not null) as 'hasEmbedding', textContent from Post where id = ${postId}`
  const postWithHasEmbedding = postsWithHasEmbedding[0]

  if (!postWithHasEmbedding) {
    logger.warn(`post '${postId}' not found`)
    return false
  }

  if (postWithHasEmbedding.hasEmbedding) {
    logger.warn(`post '${postId}' already has embedding`)
    return true
  }

  if (!postWithHasEmbedding.textContent) {
    return true
  }

  const embedding = await embeddor.getEmbeddings(postWithHasEmbedding.textContent)

  await prisma.$executeRaw`update Post set embedding = ${JSON.stringify(embedding)}::vector where id = ${postId}`

  return true
}

async function processVideo (videoId: string): Promise<boolean> {
  const videosWithHasEmbedding = await prisma.$queryRaw<MediaWithHasEmbedding[]>`select id, (embedding is not null) as 'hasEmbedding', description from Video where id = ${videoId}`
  const videoWithHasEmbedding = videosWithHasEmbedding[0]

  if (!videoWithHasEmbedding) {
    logger.warn(`video '${videoId}' not found`)
    return false
  }

  if (videoWithHasEmbedding.hasEmbedding) {
    logger.warn(`video '${videoId}' already has embedding`)
    return true
  }

  if (!videoWithHasEmbedding.description) {
    logger.warn(`video '${videoId}' does not have description`)
    return true
  }

  const embedding = await embeddor.getEmbeddings(videoWithHasEmbedding.description)

  await prisma.$executeRaw`update Video set embedding = ${JSON.stringify(embedding)}::vector where id = ${videoId}`

  return true
}

const enricher = createEnricher(environment, {
  [EnricherJobName.ENRICH_IMAGE]: processImage,
  [EnricherJobName.ENRICH_POST]: processPost,
  [EnricherJobName.ENRICH_VIDEO]: processVideo
})

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
