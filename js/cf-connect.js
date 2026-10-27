/* ============================================================================
   Cloudflare Connect 2026 — component behaviour
   ----------------------------------------------------------------------------
   Vanilla ports of the island components from cloudflare.com/connect:
     FlipperText.js      -> initFlippers      (character scramble)
     FAQAccordion.js     -> initFaqs          (grid-rows disclosure)
     StripeMorphHero.js  -> initStripeMorph   (dither stripes)
 
    The Connect globe is js/cf-globe.js: it owns the WebGL2 render target
    and the dither compositor.
     Hero.astro (bdp)    -> initBdpHero       (shake wrapper)
     homepage stats      -> initStats         (IntersectionObserver count-up)
     inline observers    -> initReveal        (.reveal stagger)

    The registration panel is js/cf-register.js: it is a separate file because
    the panel is a real form with its own lifecycle, and because nothing else on
    the page needs it. This file only calls window.__htpRegister.open() when a
    [data-cf-register-open] control is used.

   Depends on public/connect-components.css for every class it touches.
   All motion paths bail out under prefers-reduced-motion.
   ========================================================================== */

(function () {
  'use strict';

  var reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Flipper text ────────────────────────────────────────────────────────
     The flipper rotates through a broad Unicode language set. Each target carries
     its own scramble pool, language metadata, and RTL direction where needed. Cells are always sized to the
     longest target in the list, so the layout doesn't reflow on each swap.
     Cells beyond the current target's length get .is-empty (width:0).
     Timing: 2800ms dwell, 60ms per scramble frame, 6 frames, cell i offset
     by i * (flipFrameMs * 1.5). */

  var FLIPPER_WORDS = [
    { text: 'Connect', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'en', hold: 6500 },
    { text: 'つながる', pool: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん', lang: 'ja' },
    { text: 'Conectar', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑÁÉÍÓÚ', lang: 'es' },
    { text: '연결', pool: '연결만남접속관계소통연락교류함께', lang: 'ko' },
    { text: 'Verbinden', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜß', lang: 'de' },
    { text: '连接', pool: '连接通联网络系统协同合作交互建立', lang: 'zh' },
    { text: 'Connecter', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÉÈÊËÀÂÎÔÛÇ', lang: 'fr' },
    { text: 'اتصل', pool: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', dir: 'rtl', lang: 'ar' },
    { text: 'Conectar', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÃÕÂÊÔÇ', lang: 'pt' },
    { text: 'Verbinden', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ', lang: 'de' },
    { text: 'Verbinden', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ', lang: 'sv' },
    { text: 'Koble', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', lang: 'no' },
    { text: 'Yhdistä', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖ', lang: 'fi' },
    { text: 'Связь', pool: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', lang: 'ru' },
    { text: 'Kapcsolódás', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ', lang: 'hu' },
    { text: 'Połączyć', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ', lang: 'pl' },
    { text: 'Bağlan', pool: 'ABCÇDEFGĞHIİJKLMNOÖŞTUÜVYZ', lang: 'tr' },
    { text: 'Σύνδεση', pool: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ', lang: 'el' },
    { text: 'ຕິດຕໍ່', pool: 'ກຂຄງຈສຊຍດຕຖທນບປຜຝພຟມຢຣລວຫອຮ', lang: 'lo' },
    { text: 'เชื่อมต่อ', pool: 'กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ', lang: 'th' },
    { text: 'जुड़ें', pool: 'अआइईउऊऋएऐओऔकखगघचछजझटठडढतथदधनपफबभमयरलवशषसह', lang: 'hi' },
    { text: 'الاتصال', pool: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', dir: 'rtl', lang: 'fa' },
    { text: 'Связь', pool: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', lang: 'uk' },
    { text: 'Bağlan', pool: 'ABCÇDEFGĞHIİJKLMNOÖŞTUÜVYZ', lang: 'az' },
    { text: 'เชื่อมต่อ', pool: 'กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ', lang: 'th' },
    { text: 'ຕິດຕໍ່', pool: 'ກຂຄງຈສຊຍດຕຖທນບປຜຝພຟມຢຣລວຫອຮ', lang: 'lo' },
    { text: 'ຕິດຕໍ່', pool: 'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហ', lang: 'km' },
    { text: 'დაკავშირება', pool: 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ', lang: 'ka' },
    { text: 'Bağlan', pool: 'АБВГДЕӘЖЗИЙКҚЛМНҢОӨПРСТУҰҮФХҺЦЧШЩЫІЭЮЯ', lang: 'kk' },
    { text: 'ئۇلىنىش', pool: 'ابتەجخدەرزژسشغفقكگلمنئوۆپھۋۇي', dir: 'rtl', lang: 'ug' },
    { text: 'Sambung', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'id' },
    { text: 'Pagkonekta', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑ', lang: 'fil' },
    { text: 'เชื่อม', pool: 'กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ', lang: 'my' },
    { text: 'Poveži', pool: 'ABCČĆĐEFGHIJKLMNOPRSŠTUVZŽ', lang: 'hr' },
    { text: 'Povezať', pool: 'ABCČĎDÉĽĹŇÓÔŔŠŤÚÝŽ', lang: 'sk' },
    { text: 'Poveži', pool: 'ABCČĆĐŠŽ', lang: 'sl' },
    { text: 'Prijunkite', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZĄČĘĖĮŠŲŪŽ', lang: 'lt' },
    { text: 'Savienot', pool: 'AĀBCČDEĒFGĢHIĪJKĶLĻMNŅOPRŖSŠTUŪVZŽ', lang: 'lv' },
    { text: 'Ühenda', pool: 'ABCDEFGHIJKLMNOPRSŠZŽÕÄÖÜ', lang: 'et' },
    { text: 'Пайваст', pool: 'АБВГДЕЁЖЗІЙКЛМНОПРСТУЎФХЦЧШЫЬЭЮЯ', lang: 'be' },
    { text: 'Злучыць', pool: 'АБВГДЕЁЖЗІЙКЛМНОПРСТУЎФХЦЧШЫЬЭЮЯ', lang: 'be' },
    { text: 'Verbind', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'nl' },
    { text: 'Conectar', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑ', lang: 'ca' },
    { text: 'Conectar', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑ', lang: 'gl' },
    { text: 'Koble', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', lang: 'da' },
    { text: 'Tengdu', pool: 'AÁBCDÐEÉFGHIÍJKLMNOÓPRSTUÚVXYÝÞÆÖ', lang: 'is' },
    { text: 'Yhdistä', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ', lang: 'sv-FI' },
    { text: 'Свързване', pool: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ', lang: 'bg' },
    { text: 'Conectare', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZĂÂÎȘȚ', lang: 'ro' },
    { text: 'Kết nối', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZĂÂĐÊÔƠƯ', lang: 'vi' },
    { text: 'เชื่อมต่อ', pool: 'กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ', lang: 'th-TH' },
    { text: 'ಸಂಪರ್ಕಿಸಿ', pool: 'ಅಆಇಈಉಊಋಎಏಐಒಓಔಕಖಗಘಙಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲವಶಷಸಹಳ', lang: 'kn' },
    { text: 'இணை', pool: 'அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறன', lang: 'ta' },
    { text: 'కనెక్ట్', pool: 'అఆఇఈఉఊఎఏఐఒఓఔకఖగఘచఛజఝటఠడఢణతథదధనపఫబభమయరలవశషసహళ', lang: 'te' },
    { text: 'ਜੁੜੋ', pool: 'ਅਆਇਈਉਊਏਐਓਔਕਖਗਘਙਚਛਜਝਞਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵਸਹੜ', lang: 'pa' },
    { text: 'မြန်မာ', pool: 'ကခဂဃငစဆဇဈညတထဒဓနပဖဗဘမယရလဝသဟအ', lang: 'my-MM' },
    { text: 'Подключить', pool: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', lang: 'sr' },
    { text: 'Связать', pool: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', lang: 'mk' },
    { text: 'Lidh', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZËÇ', lang: 'sq' },
    { text: 'Menyambung', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'ms' },
    { text: 'Isku xir', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'so' },
    { text: 'Khokahanya', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'zu' },
    { text: 'Xhuma', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lang: 'xh' },
    { text: 'ភ្ជាប់', pool: 'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហ', lang: 'km-KH' },
    { text: 'เชื่อมต่อ', pool: 'กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ', lang: 'th-TH-2' },
    { text: '連接', pool: '一丁七万丈三上下不与专且世丘丛东丝丢两严个中丰串临为主丽举乃久么义之乌乍乎乏乐乔乙九也习乡书买乱乳乾了予争事二于亏云互五井亚些亡亨享京亭亮亲人亿什仁仅仆今介仍从仑仓仔他付仙代令以仪件价任份仿企伊伍伏伐休众优伙会伟传伤伦伯伴伶伸似但位低住体何余佛作你佣佩佳使供依侠侣侧侦侯侵便保信修俩俭俯俱俺倍倒候借倡倦健偶偷偿傲儿允元兄充先光克免兑兔入全八公六兰共关兴兵其具典养兼兽内冈册再冒写军农冠冤冬冰冶冷净准凉凌减凑凋几凡凤凭凯出击刀分切刊刃列刘则刚创初利别到制刷券刺刻前剧剩副割力功加务劣动助努劫劝办务包化北匠区医十千午升半华协单卖南博占卜卡卫印危卷厂压厌原去参又叉及友双反发叔取受口古句另只叫可台史右号司吃各合吉同名后向吐吸呀否含听启呢周味命和咐咖咬哀品哈员哥哲唐售商善喜喝喂器四回因团园困围固国图土圣在地场坏坐块坚坛坝坎均坊坞坑块址坡坤坦垂型城域基堂堡堆塔墙墨壑士壮声处备复夏夕外多夜够大天太夫央失头夷奇奈奉奏契奔奖套女奴好如妆妥妾妹妻始姐姑姓委姚姜娘婆子字存孙学宁它宅宇守安宋完宏宗官定宛宜宝实客宣室宫宰害家容宽宾宿寂密富寒寸封射将尊小少尔尖尚尤就尺尼尽尾局居届屋展山岁岛岩岭岸峡峰崇川州巡巢工左巧巨巩币市布帅师希帝带帮常帽幂干平年并幸幼幽广庄庆庐床序底店庙府度座康庸廉廊廓延建开异弃弄式弓引弟张弥弦弱弹强当录形彩影彭徐微德心必忆忍志忘忙快念忽怀态怎怒怕思急性怪总恋恨恩息恰恶悉惜惠意感愿慈慕慢懂懒成我戒或战户房所手才扎打托扣执扫扬批找技把抄抗折抬抢护报拒拟招拟拦担拐拉拣拍拴挑挖挪挤挥损捷授掌排控推措提插握揽搂搜搬搭支收改攻放政故效敏救教敢散敬数整文斗料斜斤新方施旁旅旋族旗无日旦旧早旬旺明易昏星映春是显晃晓晚景晴晶智暂暖暗暮暴曲更曼最月有朋服朗望朝期木未末本术朱机杂权杆杉李杏材村极构枪林果枝枢柜柔柱柳标栅树校株样核根格桂桃框案桌桐桑桥梁梅梦检森椅楚楷楼概槐横樱欠次欢欧欲歌止正此步武死段殿毁母每比毛气水永汁求汉江池污汤汪汽沉沙没油治沿泄法泛泡波洋洗洞活派流浅浆浇浪浴海浸消涌湖湘湾湿源溪溜滞滴漆漏演漫火灰灵灾灿炉点热烧烟照煮熟燕爱父爷爸爹片版牙牛物状特犬犯狱玄率王玩环现玲珍班球理瓶甜生用甩田由甲电男画界留畏疑病症痕痛痒癖白百的皇皮益盘盛盟目直相盾省看真眠眼着睡瞧瞪石码砂破磁示礼社祈祖祝神票禁离私秋科秒秘租秤称移程税稀稿穴究空窗立站竞章端竹笑笛第等筛算管箭箱米类粉粘精糊糖系素紫红约级纯纳纸线组细织绝统绳绿缆网罗罚置美群羽老考者而耳聋职联声背能脉脸脱腐腔脚腰腾自至致舍舌舞舟船良色艺花芳苏若苦英范草荒荷落著葡蓝藏虎虐虫蛇蛋蜜血行衣表衫补装西要见观规角解言警计认让训议讯记讲许论设访证评词试诗话该详语说请读课谁调谈谋谊谓谢贝负货质购贼赤走起越足跑距路跳身车转轻较载辉辛辞边达迁过迈运近返还这进远违连迟迫述迷追退送适逃通逗速造逢道遗醒里重野量金鉴长门闭问闲间闷闹阔队阶防阳阴阵阻阿陀附降限陕陪陵陶陷隋隆隐难雄雅集雇雾雪雷零需震霜青静非面革鞋音顶顺须领头频题额风飞食餐饭饮馆首香马骑骨高鬼鱼鲜鸟鸡鸣麻黄黑黎鼓鼻龙龄', lang: 'zh-Hant' },
  ];

  var FLIP = { interval: 2800, flipFrameMs: 60, scrambleFrames: 6 };

  function buildFlipper(root, words) {
    var maxLen = words.reduce(function (m, w) {
      return Math.max(m, Array.from(w.text).length);
    }, 0);

    var inner = document.createElement('span');
    inner.className = 'cf-flipper__inner';

    // Pin the flipper to the widest word so rotation cannot resize the box and
    // shift the centred hero title. Mirrors the min-width in the stylesheet.
    root.style.minWidth = maxLen + 'ch';

    var cells = [];
    for (var i = 0; i < maxLen; i++) {
      var cell = document.createElement('span');
      // The class list ends with a trailing space upstream; keep the same
      // shape so any selector written against it still matches.
      cell.className = 'cf-flipcell ';
      cell.setAttribute('aria-hidden', 'true');
      cells.push(cell);
      inner.appendChild(cell);
    }

    root.textContent = '';
    root.appendChild(inner);

    var wordIndex = 0;
    var timers = [];

    function clearTimers() {
      timers.forEach(function (t) {
        window.clearTimeout(t);
      });
      timers = [];
    }

    // Each cell runs its own scramble, staggered by index. `frame` walks the
    // pre-rolled noise sequence and the last entry is the real glyph.
    function runCell(cell, target, pool, delay) {
      var chars = Array.from(pool);
      var frames = [];
      for (var f = 0; f < FLIP.scrambleFrames; f++) {
        frames.push(chars[Math.floor(Math.random() * chars.length)] || '');
      }
      frames.push(target);

      var idx = 0;
      function step() {
        cell.textContent = frames[idx] === undefined ? target : frames[idx];
        idx += 1;
        if (idx < frames.length) {
          timers.push(window.setTimeout(step, FLIP.flipFrameMs));
        }
      }
      timers.push(window.setTimeout(step, delay));
    }

    function paint(word) {
      var chars = Array.from(word.text);
      var pool = word.pool;

      if (word.dir) root.setAttribute('dir', word.dir);
      else root.removeAttribute('dir');
      root.setAttribute('lang', word.lang);

      cells.forEach(function (cell, i) {
        var glyph = chars[i];
        if (glyph === undefined) {
          cell.textContent = '';
          cell.classList.add('is-empty');
          return;
        }
        cell.classList.remove('is-empty');
        if (reduceMotion) {
          cell.textContent = glyph;
          return;
        }
        runCell(cell, glyph, pool, i * FLIP.flipFrameMs * 1.5);
      });
    }

    // Paint word 0 with no scramble: the server-rendered markup already shows
    // it, and re-rolling it here would blank the hero for a frame on load.
    // The first rotation is scheduled off word 0's own dwell rather than run
    // immediately — rotating on the same tick would clear these scramble
    // timers before any of them fired.
    paint(words[0]);
    if (reduceMotion) return { clearTimers: clearTimers };

    timers.push(
      window.setTimeout(rotate, words[0].hold || FLIP.interval),
    );

    return { clearTimers: clearTimers };

    function rotate() {
      wordIndex = (wordIndex + 1) % words.length;
      var word = words[wordIndex];
      clearTimers();
      paint(word);
      timers.push(
        window.setTimeout(rotate, word.hold || FLIP.interval),
      );
    }
  }

  function initFlippers() {
    var roots = document.querySelectorAll('.cf-flipper');
    if (!roots.length) return;
    roots.forEach(function (root) {
      if (root.getAttribute('data-cf-flipper-ready')) return;
      root.setAttribute('data-cf-flipper-ready', '1');
      buildFlipper(root, FLIPPER_WORDS);
    });
  }

  /* ── FAQ accordion ──────────────────────────────────────────────────────
     Mirrors the React state: data-open on the wrapper, aria-expanded on the
     trigger, and an inline rotate() on the chevron (upstream does it with a
     style prop, not a class, so there's no rotate keyframe to lean on). */

  function initFaqs() {
    var items = document.querySelectorAll('.cf-faq');
    items.forEach(function (item) {
      if (item.getAttribute('data-cf-faq-ready')) return;
      item.setAttribute('data-cf-faq-ready', '1');

      var trigger = item.querySelector('.cf-faq__trigger');
      var chevron = item.querySelector('.cf-faq__chevron');
      var wrap = item.querySelector('.cf-faq__answer-wrap');
      if (!trigger) return;

      function setOpen(open) {
        if (open) item.setAttribute('data-open', '');
        else item.removeAttribute('data-open');
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
        if (wrap) wrap.setAttribute('aria-hidden', open ? 'false' : 'true');
      }

      // Start from the markup's own aria-expanded so server-rendered open
      // items stay open.
      setOpen(trigger.getAttribute('aria-expanded') === 'true');

      trigger.addEventListener('click', function () {
        setOpen(trigger.getAttribute('aria-expanded') !== 'true');
      });
    });
  }

  /* ── Stats count-up ──────────────────────────────────────────────────────
     One shared rAF clock per grid so every number in a grid lands on the same
     frame; grids stay independent of each other. easeInOutSine keeps velocity
     even through the middle of the run. */

  function initStats() {
    var grids = document.querySelectorAll('[data-stats-grid]');
    if (!grids.length) return;
    if (reduceMotion) return;

    function format(value, decimals, suffix) {
      return value.toFixed(decimals) + suffix;
    }

    function easeInOutSine(t) {
      return -(Math.cos(Math.PI * t) - 1) / 2;
    }

    var duration = 1000;

    function initGrid(grid) {
      var nums = grid.querySelectorAll('[data-stat-value]');
      if (!nums.length) return;

      // Snap to zero up front so the final number never flashes before the
      // count-up begins.
      var items = [];
      nums.forEach(function (el) {
        var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
        var suffix = el.getAttribute('data-suffix') || '';
        el.textContent = format(0, decimals, suffix);
        items.push({
          el: el,
          target: parseFloat(el.getAttribute('data-target') || '0'),
          decimals: decimals,
          suffix: suffix,
        });
      });

      function run() {
        var startTime = null;

        function tick(now) {
          if (startTime === null) startTime = now;
          var p = Math.min((now - startTime) / duration, 1);
          var eased = easeInOutSine(p);
          items.forEach(function (it) {
            var value = p < 1 ? it.target * eased : it.target;
            it.el.textContent = format(value, it.decimals, it.suffix);
          });
          if (p < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      }

      var io = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            run();
            obs.disconnect();
          });
        },
        { threshold: 0.4 },
      );

      io.observe(grid);
    }

    grids.forEach(initGrid);
  }

  /* ── Reveal on scroll ──────────────────────────────────────────────────
     80ms stagger per element inside a single observer batch. */

  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.style.transitionDelay = entries.indexOf(e) * 0.08 + 's';
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        });
      },
      { threshold: 0.15 },
    );
    els.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ── Nav ─────────────────────────────────────────────────────────────────
     The top banner is not a Connect island. It is shared with /money, /osint
     and /chat, so it lives in its own controller (js/cf-nav.js) which is loaded
     by every one of those pages.

     It used to live here. It could not stay: htp-nav.js swaps <body> wholesale
     when moving between /chat and /osint, which detaches the banner this code
     had bound its listeners to. The swapped-in banner then rendered with a
     dead dropdown, a dead hamburger and a frozen hover pill, silently. See the
     header of js/cf-nav.js.

     cf-connect.js still calls mountBanner() so that the homepage's own
     data-over-hero state is established in the same boot as the islands above;
     the function is a no-op if js/cf-nav.js has not loaded. */

  function mountBanner() {
    if (window.__htpBanner) window.__htpBanner.mount();
  }
  /* ── Stripe-morph hero ─────────────────────────────────────────────────
     Two stacked canvases: a low-res dither field and a heavier grain pass.
     Driven by a banded sine so the stripes breathe rather than scroll. */

  function initStripeMorph() {
    var host = document.querySelector('[data-stripe-morph-hero]');
    if (!host || reduceMotion) return;

    var canvas = host.querySelector('.stripe-morph-hero__canvas');
    var frames = host.querySelector('.stripe-morph-hero__frames');
    if (!canvas || !frames) return;

    var ctx = canvas.getContext('2d');
    var fctx = frames.getContext('2d');
    if (!ctx || !fctx) return;

    // ditherStyle 5 = ordered Bayer-ish scatter; matches the hero's grain.
    var ditherStyle = 5;
    var pixelSize = 6;
    var pixelGap = 2;
    var cols = 0;
    var rows = 0;
    var running = true;

    // 4x4 Bayer matrix, the ordered-dither kernel Cloudflare's globe uses.
    var bayer = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];

    function resize() {
      var rect = host.getBoundingClientRect();
      var w = Math.max(1, Math.floor(rect.width));
      var h = Math.max(1, Math.floor(rect.height));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w / pixelSize);
      canvas.height = Math.floor(h / pixelSize);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      frames.width = Math.floor(w * dpr);
      frames.height = Math.floor(h * dpr);
      frames.style.width = w + 'px';
      frames.style.height = h + 'px';
      cols = canvas.width;
      rows = canvas.height;
    }

    function paint(t) {
      var img = ctx.createImageData(cols, rows);
      var data = img.data;
      var cell = pixelSize + pixelGap;

      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var i = (y * cols + x) * 4;
          // Two overlapping sine bands at an angle give the morphing stripe.
          var px = x * cell;
          var py = y * cell;
          var v =
            Math.sin((px * 0.9 + py * 0.55) / 90 + t * 0.0004) * 0.5 +
            Math.sin((px * 0.35 - py * 1.1) / 140 - t * 0.00025) * 0.5;

          var threshold = (bayer[y % 4][x % 4] + 0.5) / 16;
          var lit = v * 0.5 + 0.5 > threshold;

          if (!lit) continue;
          // Phosphor-green ramp, biased toward the darker end so the hero stays
          // predominantly #3ed678 rather than washing out to #8fe6b3.
          var heat = Math.min(1, Math.max(0, (v * 0.5 + 0.5 - threshold) * 1.4));
          data[i] = Math.round(10 + heat * 52);
          data[i + 1] = Math.round(44 + heat * 170);
          data[i + 2] = Math.round(26 + heat * 94);
          data[i + 3] = Math.round(24 + heat * 40);
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function frame(t) {
      if (!running) return;
      paint(t);
      requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        var visible = entries[0].isIntersecting;
        if (visible && !running) {
          running = true;
          requestAnimationFrame(frame);
        } else if (!visible) {
          running = false;
        }
      });
      io.observe(host);
    }
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) requestAnimationFrame(frame);
    });
    requestAnimationFrame(frame);
  }

  /* ── BDP hero shake ─────────────────────────────────────────────────────
     The wrapper gets a small random offset each frame; .bdp-canvas keeps
     crisp-edges so the blocks stay hard-edged while they jitter. */

  function initBdpHero() {
    var host = document.querySelector('.bdp-hero');
    if (!host || reduceMotion) return;
    var shake = host.querySelector('.bdp-shake');
    var canvas = host.querySelector('.bdp-canvas');
    if (!shake || !canvas) return;

    var rect = host.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width));
    var h = Math.max(1, Math.floor(rect.height));
    var block = 6;
    var gap = 2;
    var cols = Math.ceil(w / (block + gap));
    var rows = Math.ceil(h / (block + gap));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cols;
    canvas.height = rows;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var img = ctx.createImageData(cols, rows);
    var running = true;

    function paint(t) {
      var data = img.data;
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var i = (y * cols + x) * 4;
          var n =
            Math.sin((x * 0.22 + t * 0.0006) * 1.0) * 0.5 +
            Math.sin((y * 0.31 - t * 0.0004) * 1.0) * 0.5;
          var lit = n * 0.5 + 0.5 > 0.55;
          if (!lit) continue;
          data[i] = 255;
          data[i + 1] = Math.round(94 + n * 30);
          data[i + 2] = 31;
          data[i + 3] = 46;
        }
      }
      ctx.putImageData(img, 0, 0);
      // Shake the wrapper, not the canvas, so pixels stay crisp.
      shake.style.transform =
        'translate(' +
        ((Math.random() * 2 - 1) * 1.5).toFixed(2) +
        'px,' +
        ((Math.random() * 2 - 1) * 1.5).toFixed(2) +
        'px)';
    }

    function frame(t) {
      if (!running) return;
      paint(t);
      requestAnimationFrame(frame);
    }

    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) requestAnimationFrame(frame);
    });
    requestAnimationFrame(frame);
  }

  /* ── Boot ───────────────────────────────────────────────────────────────
     The ticker is pure CSS animation and needs no JS. Everything else waits
     for DOMContentLoaded; nothing is on the critical path for first paint. */

  function boot() {
    mountBanner();
    initFlippers();
    initFaqs();
    initStats();
    initReveal();
    initStripeMorph();
    initBdpHero();

    var regOpen = document.querySelectorAll("[data-cf-register-open]");
    if (regOpen.length && window.__htpRegister) {
      regOpen.forEach(function (el) {
        if (el.getAttribute("data-cf-register-bound")) return;
        el.setAttribute("data-cf-register-bound", "1");
        el.addEventListener("click", function (e) {
          e.preventDefault();
          var t = el.getAttribute("data-cf-register-open") || "";
          window.__htpRegister.open(t);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
