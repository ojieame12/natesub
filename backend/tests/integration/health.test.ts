import app from '../../src/app.js'

describe('health route', () => {
  it('returns ok status', async () => {
    const res = await app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok' })
  })
})
