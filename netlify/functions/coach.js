// This runs on Netlify's server, never in the visitor's browser.
// It keeps the Anthropic API key private and relays coach conversations to Claude.

// author-notes.txt is now fetched LIVE from GitHub on every request instead of
// being bundled with the function. Edit and commit the file on GitHub and your
// very next message to the coach will use the updated notes — no Netlify
// redeploy or cold-start wait required.
//
// citations.txt is still large and stable, so it stays as a bundled local file
// read once at cold-start (no need to re-fetch it on every request).
const fs = require('fs');
const path = require('path');

const AUTHOR_NOTES_URL = 'https://raw.githubusercontent.com/tleewhalen-ux/REVEALED-AI-Coach/main/netlify/functions/author-notes.txt';

let citationSources = '';
try {
  citationSources = fs.readFileSync(path.join(__dirname, 'citations.txt'), 'utf8').trim();
} catch (err) {
  // File missing or unreadable — fail silently so the coach still works
  // without the external-source bibliography.
  console.log('citations.txt not found or unreadable:', err.message);
}

async function fetchAuthorNotes() {
  try {
    const res = await fetch(AUTHOR_NOTES_URL, {
      // Ask GitHub's raw CDN not to hand back a stale cached copy.
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) {
      console.log('author-notes.txt fetch failed with status:', res.status);
      return '';
    }
    return (await res.text()).trim();
  } catch (err) {
    // Network hiccup or file missing — fail silently so the coach still works
    // with just the built-in BOOK_CONTEXT from coach.html.
    console.log('author-notes.txt fetch error:', err.message);
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Netlify > Project configuration > Environment variables.' })
    };
  }
  try {
    const { system, messages } = JSON.parse(event.body);

    // Fetch the latest author notes fresh for this request.
    const authorNotes = await fetchAuthorNotes();

    // Append citations.txt and author-notes.txt (if present) to whatever
    // system prompt coach.html sent, so they're always the last, most-recent word.
    let fullSystem = system;
    if (citationSources) {
      fullSystem += '\n\nEXTERNAL SOURCE BIBLIOGRAPHY (real sources cited in the book — you may name these when relevant, but never reproduce their text, only attribute to them):\n' + citationSources;
    }
    if (authorNotes) {
      fullSystem += '\n\nADDITIONAL AUTHOR NOTES (treat these as authoritative, up-to-date guidance from Terry — follow them even if they refine or add to anything above):\n' + authorNotes;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: fullSystem,
        messages: messages
      })
    });
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};