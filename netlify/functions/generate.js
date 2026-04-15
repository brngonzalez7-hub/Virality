exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.messages[0].content;

    const productMatch = userMessage.match(/Product:\s*"([^"]+)"/);
    const product = productMatch ? productMatch[1] : '';

    let etsySuggestions = [];
    if (product) {
      try {
        const words = product.split(/\s+/).slice(0, 3).join(' ');
        const suffixes = ['', ' for', ' gift', ' custom', ' handmade'];
        const allSuggestions = new Set();

        for (const suffix of suffixes) {
          try {
            const etsyUrl = `https://www.etsy.com/search/suggest?q=${encodeURIComponent(words + suffix)}&locale=en-US`;
            const etsyRes = await fetch(etsyUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.etsy.com/'
              }
            });
            if (etsyRes.ok) {
              const text = await etsyRes.text();
              try {
                const data = JSON.parse(text);
                const items = Array.isArray(data) ? data : (data.results || data.queries || []);
                items.forEach(item => {
                  const s = typeof item === 'string' ? item : (item.query || item.text || item.name || '');
                  if (s) allSuggestions.add(s.toLowerCase().trim());
                });
              } catch (e) {}
            }
          } catch (e) {}
        }
        etsySuggestions = [...allSuggestions].slice(0, 15);
      } catch (e) {}
    }

    let enhancedMessage = userMessage;
    if (etsySuggestions.length > 0) {
      const suggestionsText = etsySuggestions.join(', ');
      enhancedMessage = userMessage.replace(
        'Rules:',
        `REAL Etsy search suggestions for this product (use these to inform your keyword choices — these are terms real buyers are searching for on Etsy right now):
${suggestionsText}

Use the above real Etsy search data to make your tags, title, and keywords more accurate. Prioritize terms that appear in the real Etsy suggestions. The volume/competition estimates should reflect that these are real search terms.

Rules:`
      );
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: 'You are an expert Etsy SEO specialist with access to real Etsy search data. Always respond with valid JSON only, no markdown, no backticks, no extra text. When real Etsy search suggestions are provided, prioritize those terms in your recommendations since they represent actual buyer search behavior.'
          },
          {
            role: 'user',
            content: enhancedMessage
          }
        ]
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '{}';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        content: [{ type: 'text', text }],
        etsy_suggestions: etsySuggestions,
        suggestions_count: etsySuggestions.length
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
