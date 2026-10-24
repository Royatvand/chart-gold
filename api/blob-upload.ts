import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: HandleUploadBody
  try {
    body = (await request.json()) as HandleUploadBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const expectedKey = process.env.CHART_GOLD_UPLOAD_KEY
        if (!expectedKey || clientPayload !== expectedKey) {
          throw new Error('Upload key is invalid. Enter the private upload key configured for this project.')
        }
        if (!/\.csv$|\.txt$/i.test(pathname)) {
          throw new Error('Only CSV or TXT files are allowed.')
        }
        return {
          allowedContentTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024,
        }
      },
      onUploadCompleted: async ({ blob }) => {
        console.info('Private market-data CSV uploaded:', blob.pathname, blob.size)
      },
    })

    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Blob upload failed'
    return Response.json({ error: message }, { status: 400 })
  }
}
