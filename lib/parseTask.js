// Shared between server (Node, via require) and browser (via <script>, using
// the vendored public/vendor/chrono.bundle.js which sets window.chrono).
// Keeping this file identical in both environments is what guarantees the
// live preview can never disagree with what actually gets saved.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('chrono-node'));
  } else {
    root.parseTask = factory(root.chrono).parseTask;
  }
})(typeof self !== 'undefined' ? self : this, function (chrono) {

  const PROJECT_RE = /#(\w+)/;
  const PRIORITY_RE = /(!+)\s*$/;
  // @Name must start with a capital letter and not be immediately followed by
  // digits/colon (which signals a time like "@10am" rather than a contact).
  const CONTACT_RE = /@([A-Z][a-zA-Z]*)\b(?!\s*:?\d)/;

  function collapseWhitespace(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function parseTask(rawText, referenceDate = new Date()) {
    const raw = rawText;
    let working = rawText;
    let project = null;
    let priority = 1;
    let contact = null;
    let dueAt = null;
    let hasTime = false;

    const projectMatch = working.match(PROJECT_RE);
    if (projectMatch) {
      project = projectMatch[1];
      working = working.slice(0, projectMatch.index) + working.slice(projectMatch.index + projectMatch[0].length);
    }

    const priorityMatch = working.match(PRIORITY_RE);
    if (priorityMatch) {
      priority = priorityMatch[1].length >= 2 ? 3 : 2;
      working = working.slice(0, priorityMatch.index) + working.slice(priorityMatch.index + priorityMatch[0].length);
    }

    const contactMatch = working.match(CONTACT_RE);
    if (contactMatch) {
      contact = contactMatch[1];
      working = working.slice(0, contactMatch.index) + working.slice(contactMatch.index + contactMatch[0].length);
    }

    let results = [];
    try {
      results = chrono.en.GB.parse(working, referenceDate, { forwardDate: true });
    } catch (e) {
      results = [];
    }
    if (results.length) {
      const result = results[0];
      dueAt = result.start.date();
      hasTime = result.start.isCertain('hour');
      let start = result.index;
      const end = result.index + result.text.length;
      // chrono matches "10am" but leaves a dangling "@" from "@10am" behind.
      if (working[start - 1] === '@') start -= 1;
      working = working.slice(0, start) + working.slice(end);
    }

    let title = collapseWhitespace(working);
    if (!title) title = collapseWhitespace(raw);

    return { title, dueAt, hasTime, project, priority, contact, raw };
  }

  return { parseTask };
});
