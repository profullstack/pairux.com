import type { MetadataRoute } from 'next';
import { useCases } from '@/lib/use-cases';

const BASE = 'https://pairux.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    {
      url: `${BASE}/features`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    { url: `${BASE}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/download`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    {
      url: `${BASE}/features/call-analysis`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE}/docs/agents`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE}/use-cases`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    ...useCases.map(({ slug }) => ({
      url: `${BASE}/use-cases/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: `${BASE}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${BASE}/changelog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    { url: `${BASE}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ];
}
