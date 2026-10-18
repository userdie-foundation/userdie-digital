import { db, router, json, error, requireAuth } from '@appdeploy/sdk';

const validCategories = new Set(['help', 'partnership', 'volunteer', 'other']);

export const handler = router({
  'GET /api/_healthcheck': [
    async () => json({ status: 'ok', environment: 'test-only' }),
  ],

  'POST /api/applications': [
    async ({ body }) => {
      if (!body || typeof body !== 'object')
        return error('Invalid request body', 400);
      const input = body as Record<string, unknown>;
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const category = typeof input.category === 'string' ? input.category : '';
      const description =
        typeof input.description === 'string' ? input.description.trim() : '';

      if (title.length < 3 || title.length > 120)
        return error('Title must be between 3 and 120 characters', 400);
      if (!validCategories.has(category))
        return error('Choose a valid category', 400);
      if (description.length < 5 || description.length > 2000)
        return error('Description must be between 5 and 2000 characters', 400);

      const createdAt = new Date().toISOString();
      const [id] = await db.add('applications', [
        {
          title,
          category,
          description,
          status: 'new',
          createdAt,
          environment: 'test-only',
        },
      ]);
      if (!id) return error('Could not save application', 503);

      return json(
        {
          application: {
            id,
            reference: `APP-${id}`,
            title,
            category,
            status: 'new',
            createdAt,
          },
        },
        201
      );
    },
  ],

  'GET /api/staff/applications': [
    requireAuth(),
    async () =>
      error(
        'Staff access is not configured. No application records were returned.',
        503
      ),
  ],

  'PATCH /api/staff/applications/:id': [
    requireAuth(),
    async () =>
      error(
        'Staff access is not configured. No application records were changed.',
        503
      ),
  ],
});
