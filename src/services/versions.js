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
        // Matches 1.20.1-recommended, 1.21.1-latest, etc.
        const m = key.match(/^(\d+\.\d+(?:\.\d+)?)-(?:recommended|latest)$/);
        if (!m) continue;
        
        const mc = m[1];
        let forgeVer = promos[key];
        
        // STRICT SAFETY CHECK: Ensure it's a real version like "47.2.0" and not garbage
        if (typeof forgeVer !== 'string' || !/^\d+\.\d+(\.\d+)?$/.test(forgeVer)) continue;
        
        if (!seen.has(mc)) { 
          seen.add(mc); 
          // Added universal 'loader' key so the frontend doesn't mix up arrays
          versions.push({ mc, forge: forgeVer, loader: forgeVer }); 
        }
      }
      
      return versions.slice(0, 20);
    } catch (e) {
      logger.warn('Failed to fetch Forge versions', { error: e.message });
      return [
        { mc: '1.21.1', forge: '51.0.16', loader: '51.0.16' },
        { mc: '1.20.4', forge: '49.1.0', loader: '49.1.0' },
        { mc: '1.20.1', forge: '47.3.0', loader: '47.3.0' },
        { mc: '1.19.4', forge: '45.3.0', loader: '45.3.0' },
        { mc: '1.18.2', forge: '40.2.21', loader: '40.2.21' },
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
      const latestLoader = loaderRes.data[0]?.version || '0.16.9';
      return mcVersions.map(mc => ({ mc, loader: latestLoader }));
    } catch (e) {
      logger.warn('Failed to fetch Fabric versions', { error: e.message });
      return [
        { mc: '1.21.1', loader: '0.16.9' },
        { mc: '1.21', loader: '0.16.9' },
        { mc: '1.20.4', loader: '0.16.9' },
        { mc: '1.20.1', loader: '0.16.9' },
      ];
    }
  });
}

async function getNeoForgeVersions() {
  return cached('neoforge', async () => {
    try {
      const res = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 10000 });
      
      // Extract versions like 21.1.67, 20.4.167, etc.
      const matches = [...res.data.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/g)];
      
      // Deduplicate and reverse to get newest first
      const seen = new Set();
      const versions = [];
      for (const m of matches) {
        const v = m[1];
        if (seen.has(v)) continue;
        seen.add(v);
        versions.push(v);
      }
      
      versions.reverse();
      
      // NeoForge new versioning: MC_MINOR.MC_PATCH.NEOFORGE_PATCH (e.g. 21.1.67 -> MC 1.21.1)
      return versions.slice(0, 15).map(v => {
        const parts = v.split('.');
        const mc = `1.${parts[0]}.${parts[1]}`;
        // Added universal 'loader' key so the frontend knows exactly what to put in the dropdown
        return { mc, neoforge: v, loader: v }; 
      });
    } catch (e) {
      logger.warn('Failed to fetch NeoForge versions', { error: e.message });
      return [
        { mc: '1.21.1', neoforge: '21.1.67', loader: '21.1.67' },
        { mc: '1.21', neoforge: '21.0.168', loader: '21.0.168' },
        { mc: '1.20.4', neoforge: '20.4.167', loader: '20.4.167' },
        { mc: '1.20.2', neoforge: '20.2.86', loader: '20.2.86' },
      ];
    }
  });
}

module.exports = { getForgeVersions, getFabricVersions, getNeoForgeVersions };
