const football = require('./football');

async function runAudit() {
    console.log('=== AUDIT STARTING ===');
    const dayMatches = await football.listMatches({ filter: 'upcoming' });
    console.log('Toplam Gelecek Maç Sayısı (Bülten):', dayMatches.total, 'Filtrelenen:', dayMatches.matches.length);
    if (dayMatches.matches.length > 0) {
        console.log('İlk 3 Yaklaşan Maç:', dayMatches.matches.slice(0, 3).map(m => `${m.time} | ${m.home} vs ${m.away} (${m.league.full}) [IddaaCode: ${m.iddaaCode}]`));
    }

    const coupons = await football.getCoupons();
    console.log('\n=== NESINE LIVE STATUS ===');
    console.log(coupons.nesineStatus);

    console.log('\n=== BANKO COUPON AUDIT ===');
    console.log(`Title: ${coupons.banko.title} | Single Confidence: %${coupons.banko.confidence} | Joint: %${coupons.banko.jointConfidence}`);
    coupons.banko.matches.forEach((item, idx) => {
        const m = item.m;
        const an = item.an;
        const pr = an.projections;
        console.log(`[Banko #${idx + 1}] ${m.time} - ${m.home} vs ${m.away} (${m.league.full})`);
        console.log(`  Pick: ${item.label} (Key: ${item.pick}) | Prob: %${Math.round(item.p * 100)}`);
        console.log(`  Nesine Real Odd: ${item.realOdd} | HasOdd: ${item.hasRealOdd} | Fresh: ${item.oddsFresh} | UpdatedAt: ${item.oddsUpdatedAt}`);
        console.log(`  EV: ${item.evPct !== null ? item.evPct + '%' : 'None'} | isValueBet: ${item.isValueBet}`);
        console.log(`  Data Trust: Sufficiency=%${item.dataTrust?.sufficiencyScore}, Freshness=%${item.dataTrust?.freshnessScore}, Overall=%${item.dataTrust?.overallScore}`);
        console.log(`  xG: Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | Shots: ${pr?.realShotsHFor}(${pr?.realSotHFor}) vs ${pr?.realShotsAFor}(${pr?.realSotAFor})`);
        console.log(`  Corners: ${pr?.realCornersHFor} vs ${pr?.realCornersAFor} (Total Model: ${pr?.totalCorners}) | Source: ${pr?.cornerDataSource}`);
        console.log(`  Squad: ${an.squad?.lineupType} | Missing Home: ${an.squad?.homeMissing?.length || 0}, Away: ${an.squad?.awayMissing?.length || 0}`);
        console.log(`  Rationale: ${item.rationale}`);
    });

    console.log('\n=== SURPRISE COUPON AUDIT ===');
    console.log(`Title: ${coupons.surprise.title} | Lift: ${coupons.surprise.avgLift}x | Joint: %${coupons.surprise.jointConfidence}`);
    coupons.surprise.matches.forEach((item, idx) => {
        const m = item.m;
        const an = item.an;
        console.log(`[Surprise #${idx + 1}] ${m.time} - ${m.home} vs ${m.away} (${m.league.full})`);
        console.log(`  Pick: ${item.label} (${item.contrarianType}) | Prob: %${Math.round(item.p * 100)}`);
        console.log(`  Nesine Real Odd: ${item.realOdd} | HasOdd: ${item.hasRealOdd} | Fresh: ${item.oddsFresh} | UpdatedAt: ${item.oddsUpdatedAt}`);
        console.log(`  EV: ${item.evPct !== null ? item.evPct + '%' : 'None'} | isValueBet: ${item.isValueBet}`);
        console.log(`  Data Trust: Sufficiency=%${item.dataTrust?.sufficiencyScore}, Freshness=%${item.dataTrust?.freshnessScore}`);
    });

    console.log('\n=== MATHEMATICAL & CALIBRATION CHECK ===');
    const perf = coupons.performance;
    console.log(`Evaluated Matches: ${perf?.evaluatedMatches}`);
    console.log(`Brier Score: ${perf?.brierScore} | Log Loss: ${perf?.logLoss}`);
    console.log(`Hit Rate: %${perf?.hitRatePct} (${perf?.bankoHits}/${perf?.bankoTotal})`);
    console.log(`Sufficient Data Flag: ${perf?.hasSufficientData}`);
    
    // Check joint probability math
    if (coupons.banko.matches.length > 0) {
        const calculatedJoint = Math.round(coupons.banko.matches.reduce((acc, x) => acc * x.p, 1) * 100);
        console.log(`Banko Joint Check: Stored=%${coupons.banko.jointConfidence}, Calculated=%${calculatedJoint} -> Match: ${coupons.banko.jointConfidence === calculatedJoint}`);
    }
    if (coupons.surprise.matches.length > 0) {
        const calculatedSurpriseJoint = Math.round(coupons.surprise.matches.reduce((acc, x) => acc * x.p, 1) * 100);
        console.log(`Surprise Joint Check: Stored=%${coupons.surprise.jointConfidence}, Calculated=%${calculatedSurpriseJoint} -> Match: ${coupons.surprise.jointConfidence === calculatedSurpriseJoint}`);
    }
}

runAudit().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
