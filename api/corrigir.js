// Vercel Edge Function — Proxy para API da Anthropic
// Resolve o CORS: o browser chama /api/corrigir, que chama a Anthropic com a chave segura

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CORS — permite chamadas do seu próprio domínio
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { texto, tema, nivel } = body;

    if (!texto || texto.length < 50) {
      return new Response(JSON.stringify({ error: 'Texto muito curto' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Chave API não configurada no servidor' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const nivelDesc = {
      ENEM: 'ENEM (escala 0–200 por competência, máximo 1000 pontos)',
      FUVEST: 'FUVEST/USP (critérios rigorosos de argumentação e coesão)',
      UNICAMP: 'UNICAMP (foco em gêneros discursivos e posicionamento crítico)',
      ITA: 'ITA (nível máximo de exigência, precisão argumentativa)',
    }[nivel] || 'ENEM (escala 0–200 por competência, máximo 1000 pontos)';

    const prompt = `Você é um corretor de redação experiente e rigoroso. Corrija a redação dissertativo-argumentativa abaixo nos padrões do ${nivelDesc}.

${tema ? `TEMA: "${tema}"\n` : ''}REDAÇÃO:
"""
${texto}
"""

Responda SOMENTE em JSON válido, sem markdown, sem backticks, sem texto fora do JSON:
{"nota_total":<inteiro 0-1000>,"competencias":[{"numero":1,"nome":"Domínio da norma culta","nota":<0,40,80,120,160 ou 200>,"nivel":"<Insuficiente|Regular|Bom|Muito Bom|Excelente>","pontos_fortes":"<texto específico>","erros":"<erros com exemplos do texto ou Nenhum erro grave>","dica":"<dica objetiva>"},{"numero":2,"nome":"Compreensão da proposta","nota":<0,40,80,120,160 ou 200>,"nivel":"<nivel>","pontos_fortes":"<texto>","erros":"<texto>","dica":"<texto>"},{"numero":3,"nome":"Seleção e organização de argumentos","nota":<0,40,80,120,160 ou 200>,"nivel":"<nivel>","pontos_fortes":"<texto>","erros":"<texto>","dica":"<texto>"},{"numero":4,"nome":"Coesão textual","nota":<0,40,80,120,160 ou 200>,"nivel":"<nivel>","pontos_fortes":"<texto>","erros":"<texto>","dica":"<texto>"},{"numero":5,"nome":"Proposta de intervenção","nota":<0,40,80,120,160 ou 200>,"nivel":"<nivel>","pontos_fortes":"<texto>","erros":"<texto>","dica":"<texto>"}],"resumo":"<2-3 frases com visão geral>","pontos_fortes_gerais":["<p1>","<p2>","<p3>"],"principais_melhorias":["<m1>","<m2>","<m3>"],"reescrita_intro":"<introdução melhorada mantendo o tema>"}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errData = await anthropicRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: errData?.error?.message || `Erro Anthropic: ${anthropicRes.status}` }),
        { status: anthropicRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await anthropicRes.json();
    const raw = (data.content || []).map(c => c.text || '').join('').trim();

    // Remove markdown fences se houver
    const clean = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      // Tenta extrair JSON do meio do texto
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { result = JSON.parse(match[0]); } catch { /* continua */ }
      }
      if (!result) {
        return new Response(
          JSON.stringify({ error: 'Resposta da IA inválida. Tente novamente.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Erro interno do servidor' }),
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
    );
  }
}