import React from 'react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => '/' }));
