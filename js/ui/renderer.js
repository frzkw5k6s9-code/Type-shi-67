window.Game = window.Game || {};

(function () {
  const W = 480;
  const H = 320;

  function hpColor(frac) {
    if (frac > 0.5) return '#4caf50';
    if (frac > 0.2) return '#e0c22f';
    return '#d1453b';
  }

  function drawPanel(ctx, x, y, w, h, creature) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#222';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(creature.name, x + 10, y + 20);
    ctx.font = '12px monospace';
    ctx.fillText(`Lv${creature.level}`, x + w - 46, y + 20);

    const barX = x + 10;
    const barY = y + 30;
    const barW = w - 20;
    const barH = 10;
    ctx.fillStyle = '#444';
    ctx.fillRect(barX, barY, barW, barH);
    const frac = Math.max(0, creature.hpFraction());
    ctx.fillStyle = hpColor(frac);
    ctx.fillRect(barX, barY, barW * frac, barH);
    ctx.strokeStyle = '#222';
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = '#222';
    ctx.font = '11px monospace';
    ctx.fillText(`${creature.currentHP}/${creature.stats.maxHP} HP`, barX, barY + 24);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSprite(ctx, cx, cy, r, creature) {
    if (creature.fainted) {
      ctx.fillStyle = '#999';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.6, r, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const color = Game.TypeColors[creature.types[0]] || '#888';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(r * 0.9)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(creature.name[0], cx, cy + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawButton(ctx, x, y, w, h, label, enabled = true) {
    ctx.fillStyle = enabled ? '#f4f4f4' : '#ccc';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = enabled ? '#222' : '#888';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return { x, y, w, h, label };
  }

  function drawBackground(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#bfe3f0');
    grad.addColorStop(0.55, '#bfe3f0');
    grad.addColorStop(0.55, '#8fbf6a');
    grad.addColorStop(1, '#6fa04f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTextBox(ctx, boxY, boxH) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    roundRect(ctx, 10, boxY, W - 20, boxH, 8);
    ctx.fill();
    ctx.stroke();
  }

  Game.UI = {
    WIDTH: W,
    HEIGHT: H,

    drawBattle(ctx, battle, state) {
      const buttons = [];

      drawBackground(ctx);

      // sprites
      drawSprite(ctx, W - 100, 90, 34, battle.enemy);
      drawSprite(ctx, 100, 175, 40, battle.player);

      // panels
      drawPanel(ctx, 14, 14, 190, 62, battle.enemy);
      drawPanel(ctx, W - 204, 130, 190, 62, battle.player);

      // text box area
      const boxY = 208;
      const boxH = H - boxY - 10;
      drawTextBox(ctx, boxY, boxH);

      if (state.phase === 'message' || state.phase === 'encounterEnd') {
        ctx.fillStyle = '#222';
        ctx.font = state.phase === 'encounterEnd' ? 'bold 15px monospace' : '15px monospace';
        wrapText(ctx, state.currentMessage, 24, boxY + 28, W - 48, 20);

        if (state.phase === 'message') {
          ctx.font = '12px monospace';
          ctx.fillStyle = '#666';
          ctx.fillText('(click or press Enter to continue)', 24, boxY + boxH - 12);
          buttons.push({ x: 10, y: boxY, w: W - 20, h: boxH, action: 'continue' });
        } else {
          buttons.push({ ...drawButton(ctx, 24, boxY + boxH - 40, 220, 30, 'Return to Hub'), action: 'gotoHub' });
        }
      } else if (state.phase === 'menu') {
        ctx.fillStyle = '#222';
        ctx.font = '15px monospace';
        ctx.fillText('What will you do?', 24, boxY + 26);

        const bw = 130, bh = 34, gap = 10;
        let bx = 24, by = boxY + 40;
        buttons.push({ ...drawButton(ctx, bx, by, bw, bh, 'FIGHT'), action: 'fight' });
        bx += bw + gap;
        buttons.push({ ...drawButton(ctx, bx, by, bw, bh, 'CUBE', battle.isWildBattle), action: battle.isWildBattle ? 'cube' : 'disabled' });
        bx += bw + gap;
        buttons.push({ ...drawButton(ctx, bx, by, bw, bh, 'RUN'), action: 'run' });
      } else if (state.phase === 'moves') {
        ctx.fillStyle = '#222';
        ctx.font = '15px monospace';
        ctx.fillText('Choose a move:', 24, boxY + 24);

        const bw = 210, bh = 30, gap = 8;
        battle.player.moves.forEach((m, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const bx = 24 + col * (bw + gap);
          const by = boxY + 36 + row * (bh + gap);
          const label = `${m.name} (${m.currentPP}/${m.pp})`;
          const enabled = m.currentPP > 0;
          buttons.push({ ...drawButton(ctx, bx, by, bw, bh, label, enabled), action: enabled ? `move:${i}` : 'disabled' });
        });
        buttons.push({ ...drawButton(ctx, W - 90, boxY + boxH - 38, 70, 28, 'BACK'), action: 'back' });
      }

      return buttons;
    },

    drawHub(ctx, hub) {
      const buttons = [];
      drawBackground(ctx);

      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      roundRect(ctx, 0, 0, W, H, 0);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Trainer Hub', W / 2, 30);
      ctx.textAlign = 'left';

      // player status card
      const cardX = 14, cardY = 42, cardW = W - 28, cardH = 56;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      roundRect(ctx, cardX, cardY, cardW, cardH, 8);
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.stroke();

      drawSprite(ctx, cardX + 28, cardY + 28, 20, hub.player);

      ctx.fillStyle = '#222';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`${hub.player.name}  Lv${hub.player.level}`, cardX + 56, cardY + 18);

      ctx.font = '11px monospace';
      ctx.fillText(`HP ${hub.player.currentHP}/${hub.player.stats.maxHP}`, cardX + 56, cardY + 32);
      const hpBarX = cardX + 140, hpBarW = 110, barH = 8;
      ctx.fillStyle = '#444';
      ctx.fillRect(hpBarX, cardY + 24, hpBarW, barH);
      ctx.fillStyle = hpColor(hub.player.hpFraction());
      ctx.fillRect(hpBarX, cardY + 24, hpBarW * hub.player.hpFraction(), barH);
      ctx.strokeStyle = '#222';
      ctx.strokeRect(hpBarX, cardY + 24, hpBarW, barH);

      ctx.fillStyle = '#222';
      ctx.font = '11px monospace';
      ctx.fillText(`XP ${hub.player.xp}/${hub.player.xpToNextLevel()}`, cardX + 56, cardY + 46);
      ctx.fillStyle = '#444';
      ctx.fillRect(hpBarX, cardY + 38, hpBarW, barH);
      ctx.fillStyle = '#3b8fd1';
      ctx.fillRect(hpBarX, cardY + 38, hpBarW * hub.player.xpFraction(), barH);
      ctx.strokeStyle = '#222';
      ctx.strokeRect(hpBarX, cardY + 38, hpBarW, barH);

      ctx.fillStyle = '#222';
      ctx.font = '11px monospace';
      ctx.fillText(`Badges: ${hub.badges.size}/4`, cardX + cardW - 90, cardY + 18);

      // buttons
      const bx = 24, bw = W - 48, bh = 24, gap = 6;
      let by = cardY + cardH + 10;

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('Train', bx, by);
      by += 10;
      buttons.push({ ...drawButton(ctx, bx, by, bw, bh, 'Battle a Trainer (grind XP)'), action: 'hub:train' });
      by += bh + gap;
      buttons.push({ ...drawButton(ctx, bx, by, bw, bh, 'Practice: Wild Encounter (capture cube)'), action: 'hub:wild' });
      by += bh + gap + 6;

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('Gym Challenges', bx, by);
      by += 10;

      hub.gyms.forEach((gym, i) => {
        const unlocked = i === 0 || hub.badges.has(hub.gyms[i - 1].badge.id);
        const cleared = hub.badges.has(gym.badge.id);
        let label = `Gym ${i + 1}: ${gym.gymName} - ${gym.leader} (Lv~${gym.recommendedLevel})`;
        if (cleared) label += ' (Cleared)';
        if (!unlocked) label = `Gym ${i + 1}: Locked (beat Gym ${i})`;
        buttons.push({
          ...drawButton(ctx, bx, by, bw, bh, label, unlocked),
          action: unlocked ? `hub:gym:${i}` : 'disabled',
        });
        by += bh + gap;
      });

      return buttons;
    },
  };

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let curY = y;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        ctx.fillText(line, x, curY);
        line = word + ' ';
        curY += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, curY);
  }
})();
