/**
 * Live version fetching for Forge, Fabric, NeoForge
 */
const axios = require('axios');
const { logger } = require('../utils/logger');

const cache = {};
const CACHE_TTL = 3600000; // 1 hour

function cached(key, fn) {
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < CACHE_TTL) return cache[key].data;
  return fn().then(data => { cache[key] = { data, ts: now }; return data; });
}

async function getForgeVersions() {
  return cached('forge', async () => {
    try {
      const res = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 10000 });
      const promos = res.data.promos || {};
      const versions = [];
      const seen = new Set();
      for (const key of Object.keys(promos).sort().reverse()) {
        const m = key.match(/^(\d+\.\d+(?:\.\d+)?)-(?:recommended|latest)$/);
        if (!m) continue;
        const mc = m[1];
        if (!seen.has(mc)) { seen.add(mc); versions.push({ mc, forge: promos[key] }); }
      }
      return versions.slice(0, 20);
    } catch (e) {
      logger.warn('Failed to fetch Forge versions', { error: e.message });
      return [
        { mc: '1.20.1', forge: '47.2.0' },
        { mc: '1.20.4', forge: '49.0.19' },
        { mc: '1.19.4', forge: '45.2.0' },
        { mc: '1.18.2', forge: '40.2.0' },
      ];
    }
  });
}

async function getFabricVersions() {
  return cached('fabric', async () => {
    try {
      const [mcRes, loaderRes] = await Promise.all([
        axios.get('https://meta.fabricmc.net/v2/versions/game', { timeout: 10000 }),
        axios.get('https://meta.fabricmc.net/v2/versions/loader', { timeout: 10000 }),
      ]);
      const mcVersions = mcRes.data.filter(v => v.stable).slice(0, 15).map(v => v.version);
      const latestLoader = loaderRes.data[0]?.version || '0.15.11';
      return mcVersions.map(mc => ({ mc, loader: latestLoader }));
    } catch (e) {
      logger.warn('Failed to fetch Fabric versions', { error: e.message });
      return [
        { mc: '1.21', loader: '0.15.11' },
        { mc: '1.20.4', loader: '0.15.11' },
        { mc: '1.20.1', loader: '0.15.11' },
      ];
    }
  });
}

async function getNeoForgeVersions() {
  return cached('neoforge', async () => {
    try {
      const res = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 10000 });
      const matches = [...res.data.matchAll(/<version>([\d.]+)<\/version>/g)];
      const versions = matches.map(m => m[1]).reverse().slice(0, 15);
      return versions.map(v => ({ mc: `1.${v.split('.')[0]}.${v.split('.')[1]}`, neoforge: v }));
    } catch (e) {
      logger.warn('Failed to fetch NeoForge versions', { error: e.message });
      return [
        { mc: '1.21.1', neoforge: '21.1.67' },
        { mc: '1.20.4', neoforge: '20.4.167' },
        { mc: '1.20.2', neoforge: '20.2.86' },
      ];
    }
  });
}

module.exports = { getForgeVersions, getFabricVersions, getNeoForgeVersions };
