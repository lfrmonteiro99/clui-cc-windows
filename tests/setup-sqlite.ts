import { beforeAll } from 'vitest'
import { __initSqlWasm } from './__mocks__/better-sqlite3'

beforeAll(async () => {
  await __initSqlWasm()
})
