import z from 'zod'

export const collectorMediaDataType = z.object({
  bucket: z.string(),
  key: z.string(),
  metadata: z.record(z.string(), z.unknown())
})

export type collectorMediaData = z.infer<typeof collectorMediaDataType>

export const collectorPostDataType = z.object({
  collectedAt: z.iso.datetime(),
  content: z.object({
    images: z.array(collectorMediaDataType),
    text: z.string().optional(),
    videos: z.array(collectorMediaDataType),
  }),
  createdAt: z.iso.datetime(),
  id: z.string(),
  idAtSource: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  source: z.object({
    author: z.object({
      handle: z.string().optional(),
      id: z.string(),
      name: z.string(),
      url: z.string()
    }),
    type: z.string()
  }),
  url: z.string()
})

export type CollectorPostData = z.infer<typeof collectorPostDataType>
