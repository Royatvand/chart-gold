import { get } from '@vercel/blob'

export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const expectedKey = process.env.CHART_GOLD_UPLOAD_KEY
  const suppliedKey = request.headers.get('x-upload-key')
  if (!expectedKey || suppliedKey !== expectedKey) {
    return Response.json({ error: 'Invalid upload key' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const pathname = searchParams.get('pathname')
  if (!pathname || pathname.length > 1024 || pathname.includes('..')) {
    return Response.json({ error: 'A valid blob pathname is required' }, { status: 400 })
  }

  try {
    const blob = await get(pathname, { access: 'private' })
    if (!blob || blob.statusCode !== 200) {
      return Response.json({ error: 'Blob not found' }, { status: 404 })
    }

    return new Response(blob.stream, {
      headers: {
        'Content-Type': blob.blob.contentType || 'text/csv',
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read private blob'
    return Response.json({ error: message }, { status: 500 })
  }
}
