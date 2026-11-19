import { describe, it, expect } from 'vitest';
import casesData from '../../tests/parity_cases.json';
import { validateProject, ProjectError } from './engine';
import type { ProjectDocument } from './types';

interface ParityCase {
  name: string;
  doc: any;
  python_valid: boolean;
  python_error: string | null;
}

describe('Challenger 2: TS validateProject vs Python compile_project Parity', () => {
  const cases = casesData as ParityCase[];

  it('loaded test cases properly', () => {
    expect(cases.length).toBeGreaterThanOrEqual(70);
  });

  cases.forEach((tc) => {
    it(`Case: ${tc.name} (python_valid=${tc.python_valid})`, () => {
      if (tc.python_valid) {
        // Should succeed without throwing
        expect(() => validateProject(tc.doc)).not.toThrow();
      } else {
        // Should throw ProjectError
        let errorThrown: any = null;
        try {
          validateProject(tc.doc);
        } catch (e) {
          errorThrown = e;
        }

        expect(errorThrown).toBeInstanceOf(ProjectError);
        expect(errorThrown.message).toBeDefined();
        expect(errorThrown.message.length).toBeGreaterThan(0);
      }
    });
  });
});
