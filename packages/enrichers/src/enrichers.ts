import z from 'zod'

export enum EnricherJobName {
  ENRICH_IMAGE = 'enrichImage',
  ENRICH_POST = 'enrichPost',
  ENRICH_VIDEO = 'enrichVideo'
}

export const enricherJobDataType = z.uuid()

export type EnricherJobData = z.infer<typeof enricherJobDataType>
