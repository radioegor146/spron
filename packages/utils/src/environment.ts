import z from "zod"

export function parseEnvironment<T extends z.ZodType<object, NodeJS.ProcessEnv>>(schema: T): z.infer<T> {
  return schema.parse(process.env)
}

export function zodPostgresUrl() {
  return z.url({
    protocol: /^postgres$/
  })
}

export function zodRedisUrl() {
  return z.url({
    protocol: /^redis$/
  })
}