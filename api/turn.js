/**
 * Endpoint Serverless para geração de credenciais TURN/STUN seguras
 * Compatível com Vercel Serverless Functions e ambientes Node.js
 */

export default async function handler(req, res) {
  // Configuração de cabeçalhos CORS para permitir chamadas do frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const meteredDomain = process.env.METERED_DOMAIN;
  const meteredApiKey = process.env.METERED_API_KEY;

  // 1. Se credenciais privadas do provedor (Metered Video) estiverem configuradas nas variáveis de ambiente:
  if (meteredDomain && meteredApiKey) {
    try {
      const response = await fetch(
        `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${meteredApiKey}`
      );
      if (response.ok) {
        const iceServers = await response.json();
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return res.status(200).json({ iceServers, source: 'metered-private' });
      }
    } catch (err) {
      console.error('Erro ao consultar API TURN privada:', err);
    }
  }

  // 2. Fallback de alta disponibilidade com STUNs públicos e TURN OpenRelay (50 GB/mês para testes e desenvolvimento)
  const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).json({ iceServers: defaultIceServers, source: 'metered-openrelay-fallback' });
}
