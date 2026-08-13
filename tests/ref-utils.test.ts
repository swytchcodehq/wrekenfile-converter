import { extractRefName, sanitizeName } from '../src/v2/utils/ref-utils';

describe('ref-utils', () => {
  describe('sanitizeName', () => {
    it('should keep alphanumeric and underscore names intact', () => {
      expect(sanitizeName('Foo_Bar123')).toEqual('Foo_Bar123');
    });

    it('should strip non-alphanumeric chars and append a deterministic hash to prevent collisions', () => {
      const name1 = sanitizeName('Foo-Bar');
      const name2 = sanitizeName('Foo.Bar');
      
      expect(name1).toMatch(/^Foo_Bar_[a-f0-9]+$/);
      expect(name2).toMatch(/^Foo_Bar_[a-f0-9]+$/);
      expect(name1).not.toEqual(name2);
    });
  });

  describe('extractRefName', () => {
    it('should extract and decode simple names', () => {
      expect(extractRefName('#/definitions/SimpleRef')).toEqual('SimpleRef');
    });

    it('should decode JSON pointer escape sequences ~1 and ~0 before sanitizing', () => {
      // In JSON pointer, ~1 is / and ~0 is ~
      // A key 'A/B~C' becomes 'A~1B~0C'
      // If we sanitize it, it becomes 'A_B_C' + hash of 'A/B~C'
      const refName = extractRefName('#/definitions/A~1B~0C');
      expect(refName).toBeDefined();
      expect(refName).toMatch(/^A_B_C_[a-f0-9]+$/);
    });

    it('should decode percent-encoded sequences', () => {
      const refName = extractRefName('#/definitions/My%20Space');
      expect(refName).toBeDefined();
      expect(refName).toMatch(/^My_Space_[a-f0-9]+$/);
    });
  });
});
