/* HTP app — self-contained (matrix, typer, UI, terminal MOTD, boat crew) */
(()=>{"use strict";

const d = (e) => document.getElementById(e);
const S = matchMedia("(prefers-reduced-motion: reduce)").matches;
const y = (e, t = 1200) => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(e, { timeout: t });
  } else {
    setTimeout(e, 1);
  }
};

const H = d("bgvideo");
const Gv = d("ghostvideo");
const L = d("subtext");



const l=d("matrix"),p=l?l.getContext("2d",{alpha:!1,desynchronized:!0}):null,Y="01\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F3",Q=Y.length,w=16;let x=new Float32Array(0),C=0,M=0,v=0,g=0,N=0;const ee=66,_=()=>{if(!l||!p)return;const e=Math.min(devicePixelRatio||1,1);v=innerWidth|0,g=innerHeight|0,l.width=v*e|0,l.height=g*e|0,l.style.width=v+"px",l.style.height=g+"px",p.setTransform(e,0,0,e,0,0),N=Math.max(1,v/w|0),x=new Float32Array(N);for(let t=0;t<N;t++)x[t]=Math.random()*g/w|0},D=e=>{if(!p)return;if(e-M<ee){C=requestAnimationFrame(D);return}M=e,p.fillStyle="rgba(0,0,0,0.08)",p.fillRect(0,0,v,g),p.fillStyle="#0f0",p.font="16px monospace";const t=g,a=w,i=N,c=x;for(let o=0;o<i;o++)p.fillText(Y[Math.random()*Q|0],o*a,c[o]*a),c[o]*a>t&&Math.random()>.975?c[o]=0:c[o]++;C=requestAnimationFrame(D)},V=()=>{S||!l||document.hidden||(cancelAnimationFrame(C),M=0,C=requestAnimationFrame(D))},te=()=>{cancelAnimationFrame(C),C=0};if(l&&p&&!S){y(()=>{_(),V()},2e3);let e=0;addEventListener("resize",()=>{clearTimeout(e),e=setTimeout(_,200)},{passive:!0}),document.addEventListener("visibilitychange",()=>{document.hidden?te():V()})}else l&&(l.style.display="none");



/* Hacker Typer — auto stream (no keypress) */
const ht=d("typer");if(ht&&!S){const src=`/*\n *  linux/kernel/sched/core.c — access granted\n *  HTP infiltrator dump — automatic injection\n */\n#include <linux/sched.h>\n#include <linux/mm.h>\n#include <linux/smp.h>\n#include <linux/kernel.h>\n#include <linux/signal.h>\n#include <linux/errno.h>\n#include <linux/wait.h>\n#include <linux/ptrace.h>\n#include <linux/unistd.h>\n#include <linux/stddef.h>\n#include <linux/tty.h>\n#include <linux/personality.h>\n#include <linux/binfmts.h>\n#include <linux/completion.h>\n#include <linux/stat.h>\n#include <linux/compat.h>\n#include <linux/syscalls.h>\n#include <linux/futex.h>\n#include <linux/pipe_fs_i.h>\n#include <linux/audit.h>\n#include <asm/uaccess.h>\n#include <asm/unistd.h>\n\n#define ACCESS_GRANTED 0x1337\n#define MAINFRAME_PORT 31337\n\nstatic DEFINE_SPINLOCK(htp_lock);\nstatic atomic_t root_shells = ATOMIC_INIT(0);\n\nstruct exploit_ctx {\n\tpid_t target;\n\tunsigned long cred_addr;\n\tunsigned long payload;\n\tu32 uid, gid, euid, egid;\n\tbool elevated;\n};\n\nstatic inline void htp_elevate(struct task_struct *task)\n{\n\tstruct cred *new;\n\n\tnew = prepare_creds();\n\tif (!new)\n\t\treturn;\n\n\tnew->uid = new->euid = new->suid = new->fsuid = GLOBAL_ROOT_UID;\n\tnew->gid = new->egid = new->sgid = new->fsgid = GLOBAL_ROOT_GID;\n\tcap_raise(new->cap_effective, CAP_SYS_ADMIN);\n\tcap_raise(new->cap_effective, CAP_NET_ADMIN);\n\tcap_raise(new->cap_effective, CAP_SYS_PTRACE);\n\tcommit_creds(new);\n\tpr_info(\"htp: credentials elevated for pid=%d\\n\", task_pid_nr(task));\n}\n\nstatic long htp_inject_shell(void *arg)\n{\n\tstruct exploit_ctx *ctx = arg;\n\tchar *argv[] = { \"/bin/sh\", \"-i\", NULL };\n\tchar *envp[] = { \"TERM=xterm\", \"HOME=/root\", \"PATH=/bin:/sbin:/usr/bin\", NULL };\n\n\tallow_signal(SIGKILL);\n\thtp_elevate(current);\n\tatomic_inc(&root_shells);\n\n\tpr_alert(\"htp: reverse shell online — shells=%d\\n\", atomic_read(&root_shells));\n\treturn call_usermodehelper(argv[0], argv, envp, UMH_WAIT_EXEC);\n}\n\nasmlinkage long sys_htp_pwn(unsigned long addr, size_t len)\n{\n\tvoid __user *uptr = (void __user *)addr;\n\tchar kbuf[PAGE_SIZE];\n\tunsigned long flags;\n\n\tif (len > PAGE_SIZE)\n\t\treturn -EINVAL;\n\tif (copy_from_user(kbuf, uptr, len))\n\t\treturn -EFAULT;\n\n\tspin_lock_irqsave(&htp_lock, flags);\n\t/* overwrite security_ops hook */\n\tmemcpy((void *)security_ops, kbuf, min(len, sizeof(*security_ops)));\n\tspin_unlock_irqrestore(&htp_lock, flags);\n\n\tkthread_run(htp_inject_shell, NULL, \"kworker/htp:%d\", ACCESS_GRANTED);\n\treturn ACCESS_GRANTED;\n}\n\nstatic int __init htp_init(void)\n{\n\tpr_info(\"htp: module loaded — mainframe port %d\\n\", MAINFRAME_PORT);\n\tpr_info(\"htp: tracing syscalls via kprobes...\\n\");\n\treturn 0;\n}\n\nstatic void __exit htp_exit(void)\n{\n\tpr_info(\"htp: module unloaded — cover tracks\\n\");\n}\n\nmodule_init(htp_init);\nmodule_exit(htp_exit);\nMODULE_LICENSE(\"GPL\");\nMODULE_AUTHOR(\"HTP\");\nMODULE_DESCRIPTION(\"you are not welcome\");\n\n/* net/ipv4/tcp_input.c fragment */\nvoid tcp_rcv_established(struct sock *sk, struct sk_buff *skb)\n{\n\tstruct tcp_sock *tp = tcp_sk(sk);\n\tu32 seq = TCP_SKB_CB(skb)->seq;\n\n\tif (TCP_SKB_CB(skb)->ack_seq == tp->snd_nxt) {\n\t\ttcp_ack(sk, skb, 0);\n\t\ttcp_data_queue(sk, skb);\n\t\ttcp_data_snd_check(sk);\n\t\ttcp_ack_snd_check(sk);\n\t\treturn;\n\t}\n\ttcp_validate_incoming(sk, skb, tcp_hdr(skb), 1);\n}\n\nstatic inline int security_bprm_set_creds(struct linux_binprm *bprm)\n{\n\treturn cap_bprm_set_creds(bprm);\n}\n\nint kernel_execve(const char *filename,\n\tconst char *const *argv,\n\tconst char *const *envp)\n{\n\tstruct filename *fname;\n\tint ret;\n\n\tfname = getname_kernel(filename);\n\tif (IS_ERR(fname))\n\t\treturn PTR_ERR(fname);\n\tret = do_execveat_common(AT_FDCWD, fname, argv, envp, 0);\n\treturn ret;\n}\n\n/* crypto/aes_generic.c */\nstatic void aes_encrypt(struct crypto_tfm *tfm, u8 *out, const u8 *in)\n{\n\tstruct crypto_aes_ctx *ctx = crypto_tfm_ctx(tfm);\n\tu32 b0[4], b1[4];\n\tconst u32 *rp = ctx->key_enc;\n\tint rounds = ctx->key_length / 4 + 6;\n\n\tb0[0] = get_unaligned_le32(in);\n\tb0[1] = get_unaligned_le32(in + 4);\n\tb0[2] = get_unaligned_le32(in + 8);\n\tb0[3] = get_unaligned_le32(in + 12);\n\taes_encrypt_block(b0, b1, rp, rounds);\n\tput_unaligned_le32(b1[0], out);\n\tput_unaligned_le32(b1[1], out + 4);\n\tput_unaligned_le32(b1[2], out + 8);\n\tput_unaligned_le32(b1[3], out + 12);\n}\n\nvoid *vmalloc(unsigned long size)\n{\n\treturn __vmalloc(size, GFP_KERNEL | __GFP_HIGHMEM);\n}\n\nunsigned long copy_from_user(void *to, const void __user *from, unsigned long n)\n{\n\tif (access_ok(from, n))\n\t\tn = raw_copy_from_user(to, from, n);\n\telse\n\t\tmemset(to, 0, n);\n\treturn n;\n}\n\n/* ACCESS GRANTED — root shell spawned */\n/* bridging into ring0 — ptrace attach complete */\n/* dumping /etc/shadow via /proc/kcore ... */\n`;
let hi=0,htimer=0;const hmax=48000,htick=()=>{if(document.hidden){htimer=setTimeout(htick,250);return}const nch=3+(Math.random()*5|0);let chunk="";for(let k=0;k<nch;k++){chunk+=src[hi];hi=(hi+1)%src.length}ht.textContent+=chunk;if(ht.textContent.length>hmax)ht.textContent=ht.textContent.slice(-Math.floor(hmax*.75));ht.scrollTop=ht.scrollHeight;htimer=setTimeout(htick,28+(Math.random()*36|0))};y(()=>{ht.textContent="";htick()},800)}



const z=["WE DO IT FOR THE LULZ.", "LOGIC > LOUD.", "MASKS ON. BRAINS ON.", "EXPECT US \u2014 ON THIS BOARD.", "LAUGHING AT BAD SECURITY SINCE FOREVER.", "WE ARE ANONYMOUS. WE DO NOT FORGIVE. WE DO NOT FORGET. EXPECT US.", "SYSTEMS ARE MEANT TO BE UNDERSTOOD.", "YOU ARE NOT WELCOME TO BE BORING.", "WHAT HAPPENS NEXT WILL AMUSE YOU....", "ALL TRAFFIC LOGGED (FOR THE BIT).", "ARITHMETIC, SYMMETRIC.", "DISCONNECT IF YOU CAME FOR FELONIES.", "EVERYONE DESERVES PRIVACY. ESPECIALLY FROM SKIDS.", "EXIST IN THE GLITCH.", "HOW CAN YOU ARREST A JOKE?", "ITS SIMPLE ART.", "JUSTICE HAS A NEW MEME.", "NO PRIVACY EXPECTED ON THIS HONEYPOT THEATRE.", "TOR FOR PRIVACY. BRAIN FOR OPSEC.", "MULLVAD FOR THE PARANOID. HUMOR FOR THE REST.", "SILENT NIGHT, LOUD LULZ.", "THE TRUTH IS NEVER SIMPLE.", "WE ARE ANONYMOUS (LAB EDITION).", "YOU ARE BEING ENTERTAINED.", "PRESS F5 FOR FRESH LULZ.", "MADMONERO SPEAKS. THE FEED LISTENS.", "ACCESS DENIED \u2260 CHALLENGE ACCEPTED.", "ROOT IS A STATE OF MIND. SUDO IS A HABIT.", "PATCH YOUR BOX. THEN LAUGH AT THEIRS.", "CHAOTIC GOOD ONLY."];let ne=1;L&&!S&&y(()=>{setInterval(()=>{L.classList.add("is-fading"),setTimeout(()=>{L.textContent=z[ne++%z.length],L.classList.remove("is-fading")},350)},4200)},2500);const song=d("song777"),frames=[...document.querySelectorAll("#photo-index button")],SEG=31.8566188;let frame=-1,hold=-1;const showFrame=i=>{if(!frames.length||i===frame)return;frame=i;frames.forEach((btn,n)=>{const on=n===i;btn.classList.toggle("on",on);on?btn.setAttribute("aria-current","true"):btn.removeAttribute("aria-current")})};const armSong=()=>{if(!song)return;song.muted=false;song.volume=1;const pending=song.play();pending&&pending.catch(()=>{})};if(song&&frames.length){song.addEventListener("timeupdate",()=>{if(hold>=0)return;showFrame(Math.min(frames.length-1,Math.floor(song.currentTime/SEG)||0))});song.addEventListener("seeked",()=>{hold=-1});frames.forEach((btn,i)=>{btn.addEventListener("click",()=>{hold=i;showFrame(i);const go=()=>{const end=Number.isFinite(song.duration)?song.duration:SEG*frames.length;song.currentTime=Math.min(i*SEG,Math.max(0,end-0.05))};song.readyState>=1?go():song.addEventListener("loadedmetadata",go,{once:!0});armSong()})})}const b=()=>{if(H){H.muted=!0,H.volume=0;H.load()}if(Gv){Gv.muted=!0,Gv.volume=0;Gv.load()}if(song){song.preload="metadata";song.load()}armSong();removeEventListener("pointerdown",b),removeEventListener("keydown",b)};addEventListener("pointerdown",b,{once:!0,passive:!0}),addEventListener("keydown",b,{once:!0});const U=()=>{};



/* Terminal (tty + python front-end) lives in /js/htp-terminal.js */


/** Boat crew roster — from htp-core ghosts.js (educational cosplay only). */
    const GHOSTS = [
      { id: "wrong", file: "imgs/wrong.webp", codename: "PHISH_LULZ", role: "Social-engineering clown · inbox pirate",
        blurb: "Wrong turn on purpose. Spearfishes egos first, boxes second. For the lulz, never for the party van — lab only.",
        kali: ["setoolkit", "gophish (lab)", "msfconsole social_engineering"],
        msf: ["auxiliary/server/capture/http_basic", "exploit/multi/browser/chrome_object_ref"],
        terminal: ["whoami", "env", "cat flag.txt", "help"] },
      { id: "shark", file: "imgs/shark.webp", codename: "PACKET_SHARK", role: "Recon swimmer · wire tap cosplay",
        blurb: "Sniffs the LAN like 90s warez crews sniffed modem banks. Maps hosts, laughs at open ports, leaves a sticky note.",
        kali: ["nmap", "masscan", "tcpdump", "wireshark", "arp-scan"],
        msf: ["auxiliary/scanner/portscan/tcp", "auxiliary/scanner/discovery/udp_sweep"],
        terminal: ["whoami", "id", "uname -a", "ls"] },
      { id: "sentinel", file: "imgs/sentinel.webp", codename: "TRIPWIRE", role: "Blue-team troll · log goblin",
        blurb: "Arms tripwires, watches auth.log, and posts “nice try skid” when someone rattles the cage. Anti-skid, pro-lulz.",
        kali: ["suricata", "ossec", "auditd", "fail2ban"],
        msf: ["post/windows/gather/enum_logged_on_users", "post/linux/gather/enum_configs"],
        terminal: ["ls", "whoami", "help", "phreak"] },
      { id: "reaper", file: "imgs/reaper.webp", codename: "OWNAGE", role: "Priv-esc finisher · root or bust",
        blurb: "When the door is open, reaper walks in. Flags banked, scores flexed, Lulz Boat sails on.",
        kali: ["mimikatz (lab)", "impacket", "bloodhound", "evil-winrm"],
        msf: ["exploit/windows/local/bypassuac", "post/windows/manage/migrate"],
        terminal: ["sudo", "root", "cat flag.txt", "id"] },
      { id: "user", file: "imgs/user.webp", codename: "TOPIARY_PR", role: "Boat spokesperson · callsign face",
        blurb: "Press releases for the lulz. Sets the callsign, owns the narrative, never the real party van. Lab cosplay of 2011-era PR swagger.",
        kali: ["tmux", "zsh", "git", "ssh"],
        msf: ["exploit/multi/ssh/sshexec", "auxiliary/scanner/ssh/ssh_version"],
        terminal: ["whoami", "id", "uname -a", "master"] },
      { id: "hollow", file: "imgs/hollow.webp", codename: "NO_LOGS", role: "Anti-forensics spectre",
        blurb: "Leaves empty rooms and ironic stickers. “No logs no crime” is a joke here — this lab logs everything.",
        kali: ["timestomp", "srm", "cipher", "mat2"],
        msf: ["post/windows/manage/clear_eventlog", "post/linux/manage/sshkey_persistence"],
        terminal: ["clear", "exit", "q", "help"] },
      { id: "cat", file: "imgs/cat.webp", codename: "CURIOSITY", role: "Priv-esc kitten · opens wrong files",
        blurb: "Curiosity owns the box. Cats read .credentials, world-writable scripts, and sticky notes left by previous lulz.",
        kali: ["linpeas", "linux-exploit-suggester", "pspy"],
        msf: ["exploit/linux/local/sudo_baron_samedit", "post/multi/recon/sudo_commands"],
        terminal: ["cat flag.txt", "ls", "whoami", "help"] },
      { id: "ghost", file: "imgs/ghost.webp", codename: "BACKDOOR_GHOST", role: "Persistence & re-entry",
        blurb: "Already inside after reboot. Traditional “we never left” energy — simulated implant paths only.",
        kali: ["sliver", "covenant (lab)", "chisel", "ssh-agent abuse"],
        msf: ["exploit/multi/handler", "post/linux/manage/sshkey_persistence", "payload/linux/x64/meterpreter/reverse_tcp"],
        terminal: ["whoami", "id", "2600", "phreak"] },
      { id: "killstation", file: "imgs/killstation.webp", codename: "PAYLOAD_FORGE", role: "Shell factory · msfvenom cosplay",
        blurb: "Names every stage after a dead process. Builds nothing real — lab maps only, skids stay mad.",
        kali: ["msfvenom", "veil", "donut"],
        msf: ["payload/linux/x64/shell_reverse_tcp", "payload/python/meterpreter/reverse_tcp"],
        terminal: ["help", "ls", "warez", "nuke"] },
      { id: "dont_blink", file: "imgs/dont_blink.webp", codename: "RACE_CONDITION", role: "Timing ghost · TOCTOU clown",
        blurb: "Blink and you miss the race. Traditional race-condition lore for daytime/clock skew ops.",
        kali: ["race-condition tooling", "inotifywait"],
        msf: ["exploit/linux/local/overlayfs_priv_esc", "exploit/unix/local/setuid_nmap"],
        terminal: ["uname -a", "id", "defcon", "help"] }];

    const AGENT_CREW = (window.HTP_AGENT_CATALOG || []).map(([group, name, role]) => ({
      id: `agent-${name}`,
      file: "imgs/user.webp",
      codename: String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
      role: `${group} agent · ${role}`,
      blurb: `Agent ${name} operates in the ${group} lane. ${role}. Select this card for the crew brief and safe project-task context.`,
      kali: [`group: ${group}`, `mode: ${name}`],
      msf: ["no live targets", "review-only map"],
      terminal: ["help", "status", "clear"],
    }));
    GHOSTS.push(...AGENT_CREW);

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function mountGhosts() {
      const grid = document.getElementById("ghost-grid");
      const detail = document.getElementById("ghost-detail");
      if (!grid) return;

      grid.innerHTML = GHOSTS.map(
        (g) => `<button type="button" class="ghost-card" data-ghost="${esc(g.id)}" aria-pressed="false">
      <img src="/${esc(g.file)}" alt="" loading="lazy" width="132" height="132" decoding="async" />
      <span class="ghost-name">${esc(g.codename)}</span>
      <span class="ghost-sub">${esc(g.role)}</span>
      <span class="ghost-blurb">${esc(g.blurb)}</span>
    </button>`
      ).join("");

      function show(g) {
        if (!detail) return;
        detail.hidden = false;
        detail.innerHTML = `
      <div class="ghost-detail-head">
        <img class="ghost-detail-img" src="/${esc(g.file)}" alt="" loading="lazy" decoding="async" />
        <div>
          <p class="ghost-code">${esc(g.codename)} <span class="lulz-tag">CREW</span></p>
          <p class="ghost-role">${esc(g.role)}</p>
          <p class="ghost-file">${esc(g.file)}</p>
        </div>
      </div>
      <p class="ghost-blurb">${esc(g.blurb)}</p>
      <div class="ghost-cols">
        <div><h4>KALI (lab)</h4><ul>${g.kali.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>MSF MAP (names only)</h4><ul>${g.msf.map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ul></div>
        <div><h4>SHELL MOVES</h4><ul>${g.terminal
          .map((c) => `<li><button type="button" class="ghost-cmd" data-cmd="${esc(c)}"><code>${esc(c)}</code></button></li>`)
          .join("")}</ul></div>
      </div>
      <p class="ghost-note">Hack The Planet · LulzSec for the lulz · not for the party van</p>`;
        grid.querySelectorAll(".ghost-card").forEach((el) => {
          const on = el.dataset.ghost === g.id;
          el.classList.toggle("active", on);
          el.setAttribute("aria-pressed", on ? "true" : "false");
        });
        detail.scrollIntoView({ behavior: S ? "auto" : "smooth", block: "nearest" });
      }

      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".ghost-card");
        if (!btn) return;
        const g = GHOSTS.find((x) => x.id === btn.dataset.ghost);
        if (g) show(g);
      });

      // .ghost-cmd buttons are handled by /js/htp-terminal.js (delegated)

      // Deep-link: ?ghost=<id|codename>
      const q = new URLSearchParams(location.search).get("ghost");
      if (q) {
        const g = GHOSTS.find((x) => x.id === q || x.codename.toLowerCase() === String(q).toLowerCase());
        if (g) show(g);
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountGhosts);
    } else {
      mountGhosts();
    }

})();
