import { describe, it, expect } from 'vitest';
import { isMapsUrl, linkGlyph, MAP_LINK_GLYPH } from './mapLinks';

describe('isMapsUrl', () => {
  it('detects Google Maps variants', () => {
    expect(isMapsUrl('https://www.google.com/maps/place/Eiffel+Tower')).toBe(true);
    expect(isMapsUrl('https://maps.google.com/?q=37.7,-122.4')).toBe(true);
    expect(isMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true);
    expect(isMapsUrl('https://goo.gl/maps/xyz')).toBe(true);
    expect(isMapsUrl('https://www.google.co.uk/maps/dir/A/B')).toBe(true);
  });

  it('detects Apple, Bing, OSM, Waze, Yandex, HERE', () => {
    expect(isMapsUrl('https://maps.apple.com/?ll=50.894967,4.341626')).toBe(true);
    expect(isMapsUrl('https://www.bing.com/maps?cp=47.6~-122.3')).toBe(true);
    expect(isMapsUrl('https://www.openstreetmap.org/#map=16/51.5/-0.1')).toBe(true);
    expect(isMapsUrl('https://waze.com/ul?ll=45.6,-122.5')).toBe(true);
    expect(isMapsUrl('https://yandex.com/maps/-/abc')).toBe(true);
    expect(isMapsUrl('https://wego.here.com/?map=52.5,13.4,14')).toBe(true);
  });

  it('detects geo: and native app schemes', () => {
    expect(isMapsUrl('geo:37.786971,-122.399677')).toBe(true);
    expect(isMapsUrl('comgooglemaps://?q=cafe')).toBe(true);
    expect(isMapsUrl('waze://?ll=45.6,-122.5')).toBe(true);
  });

  it('tolerates URLs without a scheme', () => {
    expect(isMapsUrl('maps.apple.com/?ll=1,2')).toBe(true);
    expect(isMapsUrl('google.com/maps')).toBe(true);
  });

  it('does not flag ordinary links or google non-maps paths', () => {
    expect(isMapsUrl('https://example.com/page')).toBe(false);
    expect(isMapsUrl('https://www.google.com/search?q=maps')).toBe(false);
    expect(isMapsUrl('https://www.google.co.uk/search?q=hi')).toBe(false);
    expect(isMapsUrl('')).toBe(false);
    expect(isMapsUrl(null)).toBe(false);
    expect(isMapsUrl(undefined)).toBe(false);
  });
});

describe('linkGlyph', () => {
  it('returns the map glyph for map links and chain glyph otherwise', () => {
    expect(linkGlyph('https://maps.apple.com/?ll=1,2')).toBe(MAP_LINK_GLYPH);
    expect(linkGlyph('https://example.com')).toBe('🔗');
  });
});
