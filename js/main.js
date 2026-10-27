(()=>{"use strict";const p=e=>document.getElementById(e),w=matchMedia("(prefers-reduced-motion: reduce)").matches,S=(e,t=1200)=>{typeof requestIdleCallback=="function"?requestIdleCallback(e,{timeout:t}):setTimeout(e,1)},i=p("terminal"),j=p("term-wrap"),o=p("cmd"),P=p("bgvideo"),gv=p("ghostvideo"),I=p("subtext"),_=p("bgmusic"),d=p("matrix"),m=d?d.getContext("2d",{alpha:!1,desynchronized:!0}):null,q=(()=>{const t=document.title;const c=[...t];return c.map(x=>x+" ").join("")})(),ne=q.length,B=16;let H=new Float32Array(0),C=0,M=0,L=0,A=0,R=0;let Bt=0;const ae=66,$=()=>{if(!d||!m)return;const e=Math.min(devicePixelRatio||1,1);L=innerWidth|0,A=innerHeight|0,d.width=L*e|0,d.height=A*e|0,d.style.width=L+"px",d.style.height=A+"px",m.setTransform(e,0,0,e,0,0),R=Math.max(13,L/B|0),H=new Float32Array(R);for(let t=0;t<R;++t)H[t]=Math.random()*A/B},U=e=>{if(!m)return;if(Bt||e-M<ae){C=requestAnimationFrame(U);return}M=e,m.fillStyle="rgba(0,0,0,0.15)",m.fillRect(0,0,L,A),m.fillStyle="#0f0",m.font="16px monospace";const t=A,l=B,s=R,n=H,resetThreshold=A/B;for(let a=0;a<s;++a)m.fillText(q[Math.random()*ne|0],a*l,n[a]*l),n[a]*l>t&&Math.random()>.975?n[a]=0:n[a]++;C=requestAnimationFrame(U)},K=()=>{!d||document.hidden||(cancelAnimationFrame(C),M=0,C=requestAnimationFrame(U))},ie=()=>{cancelAnimationFrame(C),C=0};if(d&&m){S(()=>{$(),K()},2e3);let e=0;addEventListener("resize",()=>{clearTimeout(e),e=setTimeout($,200)},{passive:!0}),document.addEventListener("visibilitychange",()=>{document.hidden?ie():K()})}const f=p("typer");if(f&&!w){const e=`/*
 *  linux/kernel/sched/core.c \u2014 access granted
 *  HTP infiltrator dump \u2014 automatic injection
 */
#include <linux/sched.h>
#include <linux/mm.h>
#include <linux/smp.h>
#include <linux/kernel.h>
#include <linux/signal.h>
#include <linux/errno.h>
#include <linux/wait.h>
#include <linux/ptrace.h>
#include <linux/unistd.h>
#include <linux/stddef.h>
#include <linux/tty.h>
#include <linux/personality.h>
#include <linux/binfmts.h>
#include <linux/completion.h>
#include <linux/stat.h>
#include <linux/compat.h>
#include <linux/syscalls.h>
#include <linux/futex.h>
#include <linux/pipe_fs_i.h>
#include <linux/audit.h>
#include <asm/uaccess.h>
#include <asm/unistd.h>

#define ACCESS_GRANTED 0x1337
#define MAINFRAME_PORT 31337

static DEFINE_SPINLOCK(htp_lock);
static atomic_t root_shells = ATOMIC_INIT(0);

struct exploit_ctx {
	pid_t target;
	unsigned long cred_addr;
	unsigned long payload;
	u32 uid, gid, euid, egid;
	bool elevated;
};

static inline void htp_elevate(struct task_struct *task)
{
	struct cred *new;

	new = prepare_creds();
	if (!new)
		return;

	new->uid = new->euid = new->suid = new->fsuid = GLOBAL_ROOT_UID;
	new->gid = new->egid = new->sgid = new->fsgid = GLOBAL_ROOT_GID;
	cap_raise(new->cap_effective, CAP_SYS_ADMIN);
	cap_raise(new->cap_effective, CAP_NET_ADMIN);
	cap_raise(new->cap_effective, CAP_SYS_PTRACE);
	commit_creds(new);
	pr_info("htp: credentials elevated for pid=%d\\n", task_pid_nr(task));
}

static long htp_inject_shell(void *arg)
{
	struct exploit_ctx *ctx = arg;
	char *argv[] = { "/bin/sh", "-i", NULL };
	char *envp[] = { "TERM=xterm", "HOME=/root", "PATH=/bin:/sbin:/usr/bin", NULL };

	allow_signal(SIGKILL);
	htp_elevate(current);
	atomic_inc(&root_shells);

	pr_alert("htp: reverse shell online \u2014 shells=%d\\n", atomic_read(&root_shells));
	return call_usermodehelper(argv[0], argv, envp, UMH_WAIT_EXEC);
}

asmlinkage long sys_htp_pwn(unsigned long addr, size_t len)
{
	void __user *uptr = (void __user *)addr;
	char kbuf[PAGE_SIZE];
	unsigned long flags;

	if (len > PAGE_SIZE)
		return -EINVAL;
	if (copy_from_user(kbuf, uptr, len))
		return -EFAULT;

	spin_lock_irqsave(&htp_lock, flags);
	/* overwrite security_ops hook */
	memcpy((void *)security_ops, kbuf, min(len, sizeof(*security_ops)));
	spin_unlock_irqrestore(&htp_lock, flags);

	kthread_run(htp_inject_shell, NULL, "kworker/htp:%d", ACCESS_GRANTED);
	return ACCESS_GRANTED;
}

static int __init htp_init(void)
{
	pr_info("htp: module loaded \u2014 mainframe port %d\\n", MAINFRAME_PORT);
	pr_info("htp: tracing syscalls via kprobes...\\n");
	return 0;
}

static void __exit htp_exit(void)
{
	pr_info("htp: module unloaded \u2014 cover tracks\\n");
}

module_init(htp_init);
module_exit(htp_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("HTP");
MODULE_DESCRIPTION("you are not welcome");

/* net/ipv4/tcp_input.c fragment */
void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
	struct tcp_sock *tp = tcp_sk(sk);
	u32 seq = TCP_SKB_CB(skb)->seq;

	if (TCP_SKB_CB(skb)->ack_seq == tp->snd_nxt) {
		tcp_ack(sk, skb, 0);
		tcp_data_queue(sk, skb);
		tcp_data_snd_check(sk);
		tcp_ack_snd_check(sk);
		return;
	}
	tcp_validate_incoming(sk, skb, tcp_hdr(skb), 1);
}

static inline int security_bprm_set_creds(struct linux_binprm *bprm)
{
	return cap_bprm_set_creds(bprm);
}

int kernel_execve(const char *filename,
	const char *const *argv,
	const char *const *envp)
{
	struct filename *fname;
	int ret;

	fname = getname_kernel(filename);
	if (IS_ERR(fname))
		return PTR_ERR(fname);
	ret = do_execveat_common(AT_FDCWD, fname, argv, envp, 0);
	return ret;
}

/* crypto/aes_generic.c */
static void aes_encrypt(struct crypto_tfm *tfm, u8 *out, const u8 *in)
{
	struct crypto_aes_ctx *ctx = crypto_tfm_ctx(tfm);
	u32 b0[4], b1[4];
	const u32 *rp = ctx->key_enc;
	int rounds = ctx->key_length / 4 + 6;

	b0[0] = get_unaligned_le32(in);
	b0[1] = get_unaligned_le32(in + 4);
	b0[2] = get_unaligned_le32(in + 8);
	b0[3] = get_unaligned_le32(in + 12);
	aes_encrypt_block(b0, b1, rp, rounds);
	put_unaligned_le32(b1[0], out);
	put_unaligned_le32(b1[1], out + 4);
	put_unaligned_le32(b1[2], out + 8);
	put_unaligned_le32(b1[3], out + 12);
}

void *vmalloc(unsigned long size)
{
	return __vmalloc(size, GFP_KERNEL | __GFP_HIGHMEM);
}

unsigned long copy_from_user(void *to, const void __user *from, unsigned long n)
{
	if (access_ok(from, n))
		n = raw_copy_from_user(to, from, n);
	else
		memset(to, 0, n);
	return n;
}

/* ACCESS GRANTED \u2014 root shell spawned */
/* bridging into ring0 \u2014 ptrace attach complete */
/* dumping /etc/shadow via /proc/kcore ... */
`;let t=0,l=0;const s=48e3,n=()=>{if(document.hidden){l=setTimeout(n,250);return}const a=3+(Math.random()*5|0);let u="";for(let g=0;g<a;g++)u+=e[t],t=(t+1)%e.length;f.textContent+=u,f.textContent.length>s&&(f.textContent=f.textContent.slice(-Math.floor(s*.75))),f.scrollTop=f.scrollHeight;if((t+1)%e.length<4)return void(f.setAttribute("data-complete","1"));l=setTimeout(n,28+(Math.random()*36|0))};S(()=>{f.textContent="",n()},800)}const V=["LIFE IS A GAME.","MONEY IS HOW WE KEEP THE SCORE.","SYSTEMS ARE MEANT TO BE BROKEN.","YOU ARE NOT WELCOME.","WHAT HAPPENS NEXT WILL SURPRISE YOU....","ALL TRAFFIC LOGGED","ARITHMETIC, SYMMETRIC","DISCONNECT NOW","EVERYONE SHOULD BE ABLE TO EXPLORE THE INTERNET WITH PRIVACY.","EXIST IN THE GLITCH.","HOW CAN YOU ARREST A COMPUTER?","ITS SIMPLE ART","JUSTICE HAS A NEW SHAPE.","NO PRIVACY EXPECTED","ONE DEATH, IN EXCHANGE FOR THOUSANDS OF LIVES!","TOR ACTIVE","MULLVAD VPN NIGGA","SILENT NIGHT, LOUD TRUTHS.","THE TRUTH IS NEVER SIMPLE.","WHAT OR WHO IS THE ANTICHRIST?","WE ARE ANONYMOUS","YOU ARE BEING WATCHED"];let se=1;I&&!w&&S(()=>{setInterval(()=>{I.classList.add("is-fading"),setTimeout(()=>{I.textContent=V[se++%V.length],I.classList.remove("is-fading")},350)},4200)},2500);const G=document.querySelectorAll("#carousel picture"),F=G.length;let O=0;F>1&&S(()=>{setInterval(()=>{const e=G[O],t=G[(O+1)%F];e.classList.remove("active"),O=(O+1)%F,t.classList.add("active")},5200)},1500);const N=()=>{P&&(P.preload="metadata",P.load(),P.play().catch(()=>{})),gv&&(gv.preload="metadata",gv.load(),gv.play().catch(()=>{})),_&&(_.volume=.35,_.play().catch(()=>{})),removeEventListener("pointerdown",N),removeEventListener("touchstart",N),removeEventListener("keydown",N)};window.__htpMedia?window.__htpMedia.onGesture(N):(addEventListener("pointerdown",N,{once:!0,passive:!0}),addEventListener("touchstart",N,{once:!0,passive:!0}));let v=null;const X=()=>{try{v=v||new(window.AudioContext||window.webkitAudioContext);const e=v.createOscillator(),t=v.createGain();e.type="sine",e.frequency.value=2600,t.gain.value=.08,e.connect(t),t.connect(v.destination),e.start(),t.gain.exponentialRampToValueAtTime(1e-4,v.currentTime+.35),e.stop(v.currentTime+.4)}catch{}};let r=null,h=null;const le={help:`Available commands:
  help     whoami   id       uname -a   ls       clear
  sudo     root     2600     phreak     hackers  nuke
  exit     q        warez    defcon    master   cat flag.txt   upload   conn`,whoami:`nobody
literally.`,id:"uid=1337(elite) gid=0(root) groups=0(root),1(bin),666(blackhat),31337(leethe)","uname -a":`Linux htp.sh 6.6.6-htp #1 SMP PREEMPT Thu Oct 13 1987 i686 GNU/Linux
Up 1337 days, 13:37, 1 user, load average: 0.00, 0.00, 0.00`,ls:`bin  boot  dev  etc  home  lib  mnt  proc  root  sbin  tmp  usr  var
flag.txt  backdoor.exe  nsa_keylogger.ko`,"cat flag.txt":"flag{y0u_4r3_n0t_3l1t3_l0l_jk_w3lc0m3}",sudo:"sudo: command not found... because you don't have permission, meatbag.",root:"Nice try, skid.",2600:`\u260E 2600 Hz tone engaged \u260E
<span class="blink red">TRUNK SEIZED \u2014 ALL CIRCUITS BUSY \u2014 ROUTING TO FBI TIP LINE</span>`,phreak:`Old-school. Respect.
Welcome, Captain Crunch.
Here's your free call: 1-800-OWN-ED`,hackers:`<span class="blink gray">&lt;BL4D3&gt;</span> What do you want?
<span class="blink cyan">&lt;CRASH_0V3RR1D3&gt;</span> We come in peace?
<span class="blink red">&lt;AC1D_BURN&gt;</span> We need your help.
<span class="blink green">&lt;R4Z0R&gt;</span> She's buff. Ballsy.
<span class="blink gray">&lt;BL4D3&gt;</span> Let's keep her.
<span class="blink green">&lt;R4Z0R&gt;</span> Waste the dude.
<span class="blink red">&lt;AC1D_BURN&gt;</span> Help us overload the Gibson!
<span class="blink green">&lt;R4Z0R&gt;</span> Hackers of the World, Unite!`,nuke:`Launching ICBM in 3... 2... 1...
Just kidding. Or am I?`,defcon:`DEFCON 1 \u2014 ALL SYSTEMS ARMED
<span class="blink red">NORAD reports inbound warheads from 127.0.0.1</span>`,master:"master@htp.sh: Permission denied... and you're ugly.",warez:"Warez? In 2025? Go touch grass.",q:`<span class="gray">[DISCONNECT]</span>
Carrier lost. Good choice.`,exit:`<span class="gray">[DISCONNECT]</span>
Carrier lost. Good choice.`},Z=["Access denied.","GTFO","You are not 0x539.","Nice try.","l0l no","Go away.","Logging attempt #42069","Got your IP."],y=[];let E=-1,W=!1;function k(){i&&requestAnimationFrame(()=>{i.scrollTop=i.scrollHeight})}function b(e,t,l){const s=document.createElement(e);return t&&(s.className=t),l!=null&&(s.textContent=l),s}function T(){h&&h.parentNode&&h.remove(),h=null}function D(){T(),i&&(h=b("span","cursor"," "),i.appendChild(h))}function J(e){if(!i||!e)return;const t=document.createDocumentFragment(),l=String(e).split(`
`);for(let s=0;s<l.length;s++)l[s]&&t.appendChild(document.createTextNode(l[s])),s<l.length-1&&t.appendChild(document.createElement("br"));i.appendChild(t)}function Q(e){if(!i||!e)return;const t=document.createElement("span");t.innerHTML=String(e).replace(/\n/g,"<br>"),i.appendChild(t)}function oe(e,t=6){return new Promise(l=>{if(!i){l();return}if(T(),w||String(e).indexOf("<")!==-1){Q(e),i.appendChild(document.createElement("br")),D(),k(),l();return}W=!0;Bt=1;let s=0;const n=e.length,a=()=>{if(s>=n){i.appendChild(document.createElement("br")),W=!1,Bt=0,D(),k(),l();return}const u=Math.min(s+4,n);J(e.slice(s,u)),s=u,k(),setTimeout(a,t)};a()})}function z(){if(!i)return;T(),r&&r.removeAttribute("data-active");const e=document.createDocumentFragment();e.appendChild(b("span","yellow","master@htp.sh:")),e.appendChild(b("span","green","~")),e.appendChild(document.createTextNode("$ ")),r=b("span","cmdline",""),r.setAttribute("data-active","1"),e.appendChild(r),i.appendChild(e),D(),o&&(o.value=""),k()}function ee(){i&&(i.replaceChildren(),i.appendChild(b("span","blink yellow","\u26A1 HTP.SH \u2013 PRIVATE PROPERTY \u2013 TRESPASSERS WILL BE VIOLATED \u26A1")),i.appendChild(document.createElement("br")),i.appendChild(b("span","blink red","CARRIER DETECTED \u2014 33600 bps \u2014 WELCOME TO HELL")),i.appendChild(document.createElement("br")),i.appendChild(b("span","cyan","\u26A1 HTP.SH \u2013 LulzBoat \u26A1 \u2014 SHENRON")),i.appendChild(document.createElement("br")),i.appendChild(b("span","gray","type help \xB7 Ctrl+D disconnect \xB7 logs are real")),i.appendChild(document.createElement("br")),z())}function x(){if(o)try{o.focus({preventScroll:!0})}catch{o.focus()}}function re(){o&&(o.addEventListener("input",()=>{r&&(r.textContent=o.value),h&&r&&h.previousSibling!==r&&i.appendChild(h),k()}),o.addEventListener("keydown",async e=>{const t=e.key;if(W&&t==="Enter"){e.preventDefault();return}if(t==="Enter"){e.preventDefault();const l=o.value.trim(),s=l.toLowerCase();if(l&&y.push(l),E=y.length,T(),r&&(r.textContent=l),i.appendChild(document.createElement("br")),o.value="",k(),s==="clear"){ee();return}if(s==="upload"||s.indexOf("upload ")==0){window.__htpUpload&&window.__htpUpload(),setTimeout(z,60);return}if(s==="conn"||s==="wire"||s==="status"){window.__htpWire&&window.__htpWire();setTimeout(z,60);return}let n=le[s]||Z[Math.random()*Z.length|0];if(/\b(fuck|shit|bitch)\b/i.test(s)){try{X()}catch{}n=`TRACE PROGRAM INITIATED \u2014 YOUR ISP HAS BEEN NOTIFIED
Sending your coordinates to local authorities...`}if(s==="2600")try{X()}catch{}await new Promise(a=>setTimeout(a,80)),await oe(n),setTimeout(z,160);return}if(t==="ArrowUp"){if(e.preventDefault(),!y.length)return;E=Math.max(0,E-1),o.value=y[E]||"",r&&(r.textContent=o.value);return}if(t==="ArrowDown"){e.preventDefault(),E<y.length-1?(E++,o.value=y[E]||""):(E=y.length,o.value=""),r&&(r.textContent=o.value);return}if(t==="c"&&e.ctrlKey){e.preventDefault(),T(),J("^C"),i.appendChild(document.createElement("br")),o.value="",z();return}t==="d"&&e.ctrlKey&&(e.preventDefault(),T(),Q(`<span class="gray">[DISCONNECT]</span>
Carrier lost. Good choice.`),i.appendChild(document.createElement("br")),D(),k())}))}function ce(){j&&j.addEventListener("click",x),i&&(i.addEventListener("click",x),i.addEventListener("focus",x)),addEventListener("keydown",e=>{if(!o||e.target===o||e.metaKey||e.altKey||e.ctrlKey||e.isComposing)return;const n=e.target;if(n&&(n.isContentEditable||/^(A|BUTTON|INPUT|TEXTAREA|SELECT|OPTION|SUMMARY|LABEL|DETAILS)$/.test(n.tagName||"")))return;if(p("htp-upload-form")&&!p("htp-upload-form").hidden)return;const t=e.key;t.length===1||t==="Backspace"||t==="Enter"||t==="Escape"||x()})}function ue(){const e=p("music-link");!e||!_||e.addEventListener("click",t=>{t.preventDefault(),_.volume=.45,_.paused?_.play().catch(()=>{}):_.pause()})}function de(){if(!i){console.warn("[htp terminal] #terminal missing");return}const e=p("terminal-static");e&&(e.hidden=!0),re(),ce(),ue(),ee();const b=p("htp-boot"),t=()=>requestAnimationFrame(()=>x()),g=()=>{!b||b.hidden?t():b.addEventListener("htp:boot-dismissed",t,{once:!0})};document.readyState==="complete"?g():addEventListener("load",g,{once:!0})}de();const Y=[{id:"wrong",file:"imgs/wrong.webp",codename:"PHISH_LULZ",role:"Social-engineering clown \xB7 inbox pirate",blurb:"Wrong turn on purpose. Spearfishes egos first, boxes second. For the lulz, never for the party van \u2014 lab only.",kali:["setoolkit","gophish (lab)","msfconsole social_engineering"],msf:["auxiliary/server/capture/http_basic","exploit/multi/browser/chrome_object_ref"],terminal:["whoami","env","cat flag.txt","help"]},{id:"shark",file:"imgs/shark.webp",codename:"PACKET_SHARK",role:"Recon swimmer \xB7 wire tap cosplay",blurb:"Sniffs the LAN like 90s warez crews sniffed modem banks. Maps hosts, laughs at open ports, leaves a sticky note.",kali:["nmap","masscan","tcpdump","wireshark","arp-scan"],msf:["auxiliary/scanner/portscan/tcp","auxiliary/scanner/discovery/udp_sweep"],terminal:["whoami","id","uname -a","ls"]},{id:"sentinel",file:"imgs/sentinel.webp",codename:"TRIPWIRE",role:"Blue-team troll \xB7 log goblin",blurb:"Arms tripwires, watches auth.log, and posts \u201Cnice try skid\u201D when someone rattles the cage. Anti-skid, pro-lulz.",kali:["suricata","ossec","auditd","fail2ban"],msf:["post/windows/gather/enum_logged_on_users","post/linux/gather/enum_configs"],terminal:["ls","whoami","help","phreak"]},{id:"reaper",file:"imgs/reaper.webp",codename:"OWNAGE",role:"Priv-esc finisher \xB7 root or bust",blurb:"When the door is open, reaper walks in. Flags banked, scores flexed, Lulz Boat sails on.",kali:["mimikatz (lab)","impacket","bloodhound","evil-winrm"],msf:["exploit/windows/local/bypassuac","post/windows/manage/migrate"],terminal:["sudo","root","cat flag.txt","id"]},{id:"user",file:"imgs/user.webp",codename:"TOPIARY_PR",role:"Boat spokesperson \xB7 callsign face",blurb:"Press releases for the lulz. Sets the callsign, owns the narrative, never the real party van. Lab cosplay of 2011-era PR swagger.",kali:["tmux","zsh","git","ssh"],msf:["exploit/multi/ssh/sshexec","auxiliary/scanner/ssh/ssh_version"],terminal:["whoami","id","uname -a","master"]},{id:"hollow",file:"imgs/hollow.webp",codename:"NO_LOGS",role:"Anti-forensics spectre",blurb:"Leaves empty rooms and ironic stickers. \u201CNo logs no crime\u201D is a joke here \u2014 this lab logs everything.",kali:["timestomp","srm","cipher","mat2"],msf:["post/windows/manage/clear_eventlog","post/linux/manage/sshkey_persistence"],terminal:["clear","exit","q","help"]},{id:"cat",file:"imgs/cat.webp",codename:"CURIOSITY",role:"Priv-esc kitten \xB7 opens wrong files",blurb:"Curiosity owns the box. Cats read .credentials, world-writable scripts, and sticky notes left by previous lulz.",kali:["linpeas","linux-exploit-suggester","pspy"],msf:["exploit/linux/local/sudo_baron_samedit","post/multi/recon/sudo_commands"],terminal:["cat flag.txt","ls","whoami","help"]},{id:"ghost",file:"imgs/ghost.webp",codename:"BACKDOOR_GHOST",role:"Persistence & re-entry",blurb:"Already inside after reboot. Traditional \u201Cwe never left\u201D energy \u2014 simulated implant paths only.",kali:["sliver","covenant (lab)","chisel","ssh-agent abuse"],msf:["exploit/multi/handler","post/linux/manage/sshkey_persistence","payload/linux/x64/meterpreter/reverse_tcp"],terminal:["whoami","id","2600","phreak"]},{id:"killstation",file:"imgs/killstation.webp",codename:"PAYLOAD_FORGE",role:"Shell factory \xB7 msfvenom cosplay",blurb:"Names every stage after a dead process. Builds nothing real \u2014 lab maps only, skids stay mad.",kali:["msfvenom","veil","donut"],msf:["payload/linux/x64/shell_reverse_tcp","payload/python/meterpreter/reverse_tcp"],terminal:["help","ls","warez","nuke"]},{id:"dont_blink",file:"imgs/dont_blink.webp",codename:"RACE_CONDITION",role:"Timing ghost \xB7 TOCTOU clown",blurb:"Blink and you miss the race. Traditional race-condition lore for daytime/clock skew ops.",kali:["race-condition tooling","inotifywait"],msf:["exploit/linux/local/overlayfs_priv_esc","exploit/unix/local/setuid_nmap"],terminal:["uname -a","id","defcon","help"]}];function c(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function te(){const e=document.getElementById("ghost-grid"),t=document.getElementById("ghost-detail");if(!e)return;e.innerHTML=Y.map(n=>`<button type="button" class="ghost-card" data-ghost="${c(n.id)}" aria-pressed="false">
      <img src="${c(n.file)}" alt="${c(n.codename)} ghost card" loading="lazy" width="132" height="132" decoding="async" />
      <span class="ghost-name">${c(n.codename)}</span>
      <span class="ghost-sub">${c(n.role)}</span>
    </button>`).join("");function l(n){t&&(t.hidden=!1,t.innerHTML=`
      <div class="ghost-detail-head">
        <img class="ghost-detail-img" src="${c(n.file)}" alt="${c(n.codename)} ghost card" loading="lazy" decoding="async" />
        <div>
          <p class="ghost-code">${c(n.codename)} <span class="lulz-tag">CREW</span></p>
          <p class="ghost-role">${c(n.role)}</p>
          <p class="ghost-file">${c(n.file)}</p>
        </div>
      </div>
      <p class="ghost-blurb">${c(n.blurb)}</p>
      <div class="ghost-cols">
        <div><h4>KALI (lab)</h4><ul>${n.kali.map(a=>`<li>${c(a)}</li>`).join("")}</ul></div>
        <div><h4>MSF MAP (names only)</h4><ul>${n.msf.map(a=>`<li><code>${c(a)}</code></li>`).join("")}</ul></div>
        <div><h4>SHELL MOVES</h4><ul>${n.terminal.map(a=>`<li><button type="button" class="ghost-cmd" data-cmd="${c(a)}"><code>${c(a)}</code></button></li>`).join("")}</ul></div>
      </div>
      <p class="ghost-note">Hack The Planet \xB7 LulzSec for the lulz \xB7 not for the party van</p>`,e.querySelectorAll(".ghost-card").forEach(a=>{const u=a.dataset.ghost===n.id;a.classList.toggle("active",u),a.setAttribute("aria-pressed",u?"true":"false")}),t.scrollIntoView({behavior:"smooth",block:"nearest"}))}e.addEventListener("click",n=>{const a=n.target.closest(".ghost-card");if(!a)return;const u=Y.find(g=>g.id===a.dataset.ghost);u&&l(u)}),t?.addEventListener("click",n=>{const a=n.target.closest(".ghost-cmd");if(!a)return;const u=a.dataset.cmd||"",g=document.getElementById("cmd"),pe=document.getElementById("terminal");g&&pe&&(g.value=u,g.focus(),g.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:!0,cancelable:!0})),document.getElementById("term-wrap")?.scrollIntoView({behavior:"smooth",block:"center"}))});const s=new URLSearchParams(location.search).get("ghost");if(s){const n=Y.find(a=>a.id===s||a.codename.toLowerCase()===String(s).toLowerCase());n&&l(n)}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",te):te()})();
(()=>{
"use strict";
var __u={max:10485760};
var __t=document.getElementById("terminal"),__c=document.getElementById("cmd");
function __app(txt,cls){if(!__t)return;var s=document.createElement("span");if(cls)s.className=cls;s.textContent=txt;__t.appendChild(s);__t.appendChild(document.createElement("br"));__t.scrollTop=__t.scrollHeight;}
function __fmt(n){if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KiB";return (n/1048576).toFixed(2)+" MiB";}
function __link(txt,url,onclick){
  if(!__t)return;
  var a=document.createElement("a");a.className="htp-link";a.textContent=txt;a.href=url;a.rel="noopener";
  a.addEventListener("click",function(e){e.preventDefault();onclick&&onclick();});
  __t.appendChild(a);__t.appendChild(document.createElement("br"));__t.scrollTop=__t.scrollHeight;
}
function __card(file,url,mime){
  var g=document.getElementById("htp-gallery");if(!g)return;
  g.hidden=false;
  var card=document.createElement("article");card.className="htp-g";card.setAttribute("aria-label",file.name);
  var media=document.createElement("div");media.className="htp-g-media";
  function box(tag,attrs){var el=document.createElement(tag);for(var k in attrs)el.setAttribute(k,attrs[k]);media.appendChild(el);return el;}
  if(mime.indexOf("image/")===0){var im=box("img",{src:url,alt:file.name,loading:"lazy"});im.onerror=function(){media.textContent="[unviewable]";};}
  else if(mime.indexOf("video/")===0)box("video",{src:url,controls:"",preload:"metadata",playsinline:""});
  else if(mime.indexOf("audio/")===0)box("audio",{src:url,controls:""});
  else{var dl=document.createElement("a");dl.textContent=url;dl.href=url;dl.target="_blank";dl.rel="noopener";dl.className="htp-btn";box("div",{}).appendChild(dl);}
  card.appendChild(media);
  var meta=document.createElement("div");meta.className="htp-g-meta";
  var nm=document.createElement("a");nm.className="htp-g-name";nm.textContent=file.name;nm.title=file.name;nm.href=url;nm.rel="noopener";
  nm.addEventListener("click",function(e){e.preventDefault();__info(file,url,mime);});
  var sz=document.createElement("span");sz.className="htp-g-size";sz.textContent=__fmt(file.size)+" \u00B7 "+(file.type||"application/octet-stream");
  var ul=document.createElement("a");ul.className="htp-g-url";ul.textContent=url;ul.href=url;ul.target="_blank";ul.rel="noopener";
  ul.addEventListener("click",function(e){e.preventDefault();__info(file,url,mime);});
  var act=document.createElement("div");act.className="htp-g-actions";
  var info=document.createElement("button");info.type="button";info.className="htp-btn";info.textContent="info";
  info.addEventListener("click",function(){__info(file,url,mime);});
  var copy=document.createElement("button");copy.type="button";copy.className="htp-btn";copy.textContent="copy url";
  copy.addEventListener("click",function(){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url);__app("[+] URL copied \u2192 "+url,"ok");});
  var open=document.createElement("a");open.className="htp-btn";open.href=url;open.target="_blank";open.rel="noopener";open.textContent="open";
  var drop=document.createElement("button");drop.type="button";drop.className="htp-btn htp-btn-warn";drop.textContent="drop";
  drop.addEventListener("click",function(){try{URL.revokeObjectURL(url);}catch(_){}card.remove();});
  act.appendChild(info);act.appendChild(copy);act.appendChild(open);act.appendChild(drop);
  meta.appendChild(nm);meta.appendChild(sz);meta.appendChild(ul);meta.appendChild(act);
  card.appendChild(meta);
  g.appendChild(card);
  __app("[+] UPLOAD OK \u2014 "+file.name+" ("+__fmt(file.size)+")","ok");
  __link("    url: "+url+"  [headers + info]", url, function(){__info(file,url,mime);});
  return card;
}
function __sig(b){
  if(!b||b.length<4)return "truncated / empty";
  if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return "PNG image";
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return "JPEG image";
  if(b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38)return "GIF image";
  if(b.length>=12&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50)return "WebP image";
  if(b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46)return "PDF document";
  if(b[0]===0x50&&b[1]===0x4B&&(b[2]===0x03||b[2]===0x05||b[2]===0x07))return "ZIP archive (maybe docx/xlsx)";
  if(b[0]===0x4D&&b[1]===0x5A)return "PE executable (windows)";
  if(b[0]===0x7F&&b[1]===0x45&&b[2]===0x4C&&b[3]===0x46)return "ELF executable";
  if(b[0]===0x1F&&b[1]===0x8B)return "gzip archive";
  if(b.length>=8&&b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70)return "MP4 / QuickTime container (ftyp)";
  if(b[0]===0x49&&b[1]===0x44&&b[2]===0x33)return "MP3 audio (ID3 tag)";
  if(b[0]===0x4F&&b[1]===0x67&&b[2]===0x67&&b[3]===0x53)return "OGG audio";
  if(b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46)return "RIFF container (WAV/AVI/WebP)";
  if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)return "UTF-8 text (BOM)";
  if(b[0]===0x7B||b[0]===0x5B)return "text (JSON bracket)";
  var printable=true;for(var i=0;i<b.length;i++){var c=b[i];if((c<0x20&&c!==0x09&&c!==0x0A&&c!==0x0D)||c===0x7F){printable=false;break;}}
  if(printable)return "plain text";
  return "no known signature";
}
function __info(file,url,mime){
  var form=document.getElementById("htp-info-form");if(!form)return;
  var body=document.getElementById("htp-info-body");if(!body)return;
  body.replaceChildren();
  var makeDL=function(){var d=document.createElement("dl");d.className="htp-info-kv";return d;};
  var setRow=function(dl,k,v,mono){var d=document.createElement("div");var dt=document.createElement("dt");dt.textContent=k;var dd=document.createElement("dd");dd.textContent=v;if(mono)dd.className="mono";d.appendChild(dt);d.appendChild(dd);dl.appendChild(d);};
  var setEl=function(dl,k,el){var d=document.createElement("div");var dt=document.createElement("dt");dt.textContent=k;var dd=document.createElement("dd");dd.appendChild(el);d.appendChild(dt);d.appendChild(dd);dl.appendChild(d);};
  var head=document.createElement("div");head.className="htp-info-head";
  var tag=document.createElement("span");tag.className="tag";tag.textContent="BLOB INFO";
  var ttl=document.createElement("span");ttl.className="htp-info-title";ttl.textContent=file.name;
  head.appendChild(tag);head.appendChild(ttl);
  body.appendChild(head);
  var md=makeDL();setRow(md,"Name",file.name);setRow(md,"Type (reported)",file.type||"application/octet-stream");setRow(md,"Size",file.size+" bytes \u00B7 "+__fmt(file.size),true);setRow(md,"Last modified",file.lastModified?new Date(file.lastModified).toISOString():"unknown",true);body.appendChild(md);
  var udl=makeDL();var ua=document.createElement("a");ua.className="htp-link";ua.textContent=url;ua.href=url;ua.target="_blank";ua.rel="noopener";var ub=document.createElement("button");ub.type="button";ub.className="htp-btn";ub.textContent="copy";ub.addEventListener("click",function(){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url);});setEl(udl,"Blob URL",ua);udl.lastChild.querySelector("dd").appendChild(ub);body.appendChild(udl);
  var hs=document.createElement("section");hs.className="htp-info-sec";var h3=document.createElement("h3");h3.textContent="HTTP HEADERS";var hn=document.createElement("p");hn.className="htp-info-note";hn.textContent="headers returned by the browser for this blob resource";var hdl=makeDL();var hp=document.createElement("div");hp.className="pending";hp.textContent="reading headers\u2026";hdl.appendChild(hp);hs.appendChild(h3);hs.appendChild(hn);hs.appendChild(hdl);body.appendChild(hs);
  var sec=function(title,note){var s=document.createElement("section");s.className="htp-info-sec";var th=document.createElement("h3");th.textContent=title;var tn=document.createElement("p");tn.className="htp-info-note";tn.textContent=note;var dl=makeDL();s.appendChild(th);s.appendChild(tn);s.appendChild(dl);body.appendChild(s);return dl;};
  var dgl=sec("DIGEST & SIGNATURE","SHA-256 of the bytes + magic-byte sniff of the first 16");
  var pvl=sec("PREVIEW","live probe of the decoded resource");
  var dp=document.createElement("div");dp.className="pending";dp.textContent="computing\u2026";dgl.appendChild(dp);
  var pp=document.createElement("div");pp.className="pending";pp.textContent="probing\u2026";pvl.appendChild(pp);
  form.hidden=false;
  var cx=document.getElementById("htp-info-close");
  if(cx){try{cx.focus();}catch(_){}}
  try{
    fetch(url).then(function(r){return r.headers;}).then(function(hd){
      hdl.replaceChildren();
      if(!hd||!hd.forEach){var n=document.createElement("div");n.className="dim";n.textContent="(no header object available)";hdl.appendChild(n);return;}
      var any=false;
      hd.forEach(function(v,k){var d=document.createElement("div");var dt=document.createElement("dt");dt.textContent=k;var dd=document.createElement("dd");dd.textContent=v;dd.className="mono";d.appendChild(dt);d.appendChild(dd);hdl.appendChild(d);any=true;});
      if(!any){var n2=document.createElement("div");n2.className="dim";n2.textContent="(browser exposed no headers for this blob)";hdl.appendChild(n2);}
    }).catch(function(e){hdl.replaceChildren();var n=document.createElement("div");n.className="bad";n.textContent="(could not read headers: "+e+")";hdl.appendChild(n);});
  }catch(e){}
  try{
    file.slice(0,16).arrayBuffer().then(function(ab){
      var b=new Uint8Array(ab),hex=[];for(var i=0;i<b.length;i++)hex.push(("0"+b[i].toString(16)).slice(-2));
      setRow(dgl,"Signature","0x"+hex.join(" ")+" \u2192 "+__sig(b),true);
      return file.arrayBuffer();
    }).then(function(buf){
      return crypto.subtle.digest("SHA-256",buf);
    }).then(function(ab){
      var b=new Uint8Array(ab),hex="";for(var i=0;i<b.length;i++)hex+=("0"+b[i].toString(16)).slice(-2);
      setRow(dgl,"SHA-256",hex,true);
    }).catch(function(e){setRow(dgl,"Digest","(failed: "+e+")");});
  }catch(e){}
  try{
    if(mime.indexOf("image/")===0){
      var im=new Image();
      im.onload=function(){pvl.replaceChildren();setRow(pvl,"Image dimensions",im.naturalWidth+" \u00D7 "+im.naturalHeight+" px",true);};
      im.onerror=function(){pvl.replaceChildren();var n=document.createElement("div");n.className="dim";n.textContent="(could not decode image preview)";pvl.appendChild(n);};
      im.src=url;
    }else if(mime.indexOf("video/")===0){
      var vd=document.createElement("video");vd.preload="metadata";
      vd.onloadedmetadata=function(){pvl.replaceChildren();if(vd.videoWidth)setRow(pvl,"Video dimensions",vd.videoWidth+" \u00D7 "+vd.videoHeight+" px",true);if(vd.duration&&isFinite(vd.duration))setRow(pvl,"Duration",vd.duration.toFixed(2)+" s",true);};
      vd.onerror=function(){pvl.replaceChildren();var n=document.createElement("div");n.className="dim";n.textContent="(could not read video metadata)";pvl.appendChild(n);};
      vd.src=url;
    }else{pvl.replaceChildren();var n=document.createElement("div");n.className="dim";n.textContent="no inline preview probe for "+mime;pvl.appendChild(n);}
  }catch(e){}
}
function __infoClose(){
  var f=document.getElementById("htp-info-form");
  if(f)f.hidden=true;
  if(__c){try{__c.focus({preventScroll:true});}catch(_){__c.focus();}}
}
function __handle(files){
  var st=document.getElementById("htp-upload-status");
  var n=0;
  Array.prototype.forEach.call(files||[],function(f){
    if(f.size>__u.max){__app("[-] "+f.name+" refused (>10 MiB)","bad");if(st){var e=document.createElement("div");e.className="bad";e.textContent="[-] REFUSED "+f.name+" \u2014 exceeds 10 MiB";st.appendChild(e);}return;}
    var url;try{url=URL.createObjectURL(f);}catch(err){__app("[-] upload failed: "+err,"bad");return;}
    __card(f,url,f.type||"application/octet-stream");n++;
  });
  if(st&&n===0){var w=document.createElement("div");w.className="bad";w.textContent="[-] nothing accepted \u2014 check the size limit";st.appendChild(w);}
}
function __open(){
  var form=document.getElementById("htp-upload-form");if(!form)return;
  var st=document.getElementById("htp-upload-status");if(st)st.textContent="";
  form.hidden=false;
  var file=document.getElementById("htp-upload-file");
  if(file){try{file.value="";}catch(_){}file.focus();}
  __app("[i] upload form open \u2014 choose or drop a file","cyan");
}
function __close(){
  var form=document.getElementById("htp-upload-form");if(form)form.hidden=true;
  if(__c){try{__c.focus({preventScroll:true});}catch(_){__c.focus();}}
}
function __lb(){
  try{if(window.matchMedia&&matchMedia("(prefers-reduced-data: reduce)").matches)return;}catch(_){}
  var seen={},idle=function(fn){if(typeof requestIdleCallback==="function")requestIdleCallback(fn,{timeout:2000});else setTimeout(fn,1);};
  function pc(src){try{var u=new URL(src,location.href);if(u.protocol!=="https:")return;var o=u.origin;if(seen[o])return;seen[o]=1;var l=document.createElement("link");l.rel="preconnect";l.href=o;l.crossOrigin="anonymous";document.head.appendChild(l);}catch(_){}}
  function scan(){try{var nodes=document.querySelectorAll("link[href],script[src],img[src],source[src],video[src],audio[src],iframe[src]");Array.prototype.forEach.call(nodes,function(el){var h=el.getAttribute("href")||el.getAttribute("src");if(h)pc(h);var ss=el.getAttribute("srcset");if(ss)ss.split(",").forEach(function(c){var u=c.trim().split(/\s+/)[0];if(u)pc(u);});});}catch(_){}}
  function q(){
    var jobs=[];try{Array.prototype.forEach.call(document.images,function(im){if(im.loading==="lazy"&&!(im.complete)&&im.currentSrc)jobs.push(im.currentSrc);});}catch(_){}
    if(!jobs.length)return;var i=0,act=0;
    (function next(){while(act<2&&i<jobs.length){var src=jobs[i++];act++;var im=new Image();im.decoding="async";im.onload=im.onerror=function(){act--;next();};im.src=src;}})();
  }
  window.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.src&&t.dataset.htpretry!=="1"){t.dataset.htpretry="1";var im=new Image();im.onload=function(){t.src=im.src;};im.onerror=function(){t.dataset.htpretry="0";};try{var u=new URL(t.src);u.searchParams.set("htpr",String(Date.now()));im.src=u.toString();}catch(_){}}},true);
  idle(scan);
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")idle(scan);});
  window.addEventListener("load",function(){idle(scan);idle(q);document.addEventListener("pointerdown",function(){idle(q);},{once:true,passive:true});});
}
function __init(){
  var form=document.getElementById("htp-upload-form"),file=document.getElementById("htp-upload-file"),zone=document.getElementById("htp-upload-zone");
  __lb();
  if(!form||!file||!zone)return;
  file.addEventListener("change",function(){__handle(file.files);});
  ["dragenter","dragover"].forEach(function(ev){zone.addEventListener(ev,function(e){e.preventDefault();zone.classList.add("over");});});
  ["dragleave","drop"].forEach(function(ev){zone.addEventListener(ev,function(e){e.preventDefault();if(ev==="drop")__handle(e.dataTransfer?e.dataTransfer.files:null);zone.classList.remove("over");});});
  var close=document.getElementById("htp-upload-close");
  if(close)close.addEventListener("click",function(){__close();});
  form.addEventListener("click",function(e){if(e.target===form)__close();});
  var iform=document.getElementById("htp-info-form"),iclose=document.getElementById("htp-info-close");
  if(iclose)iclose.addEventListener("click",function(){__infoClose();});
  if(iform)iform.addEventListener("click",function(e){if(e.target===iform)__infoClose();});
  document.addEventListener("keydown",function(e){if(e.key!=="Escape")return;if(iform&&!iform.hidden)__infoClose();else if(!form.hidden)__close();});
  window.__htpUpload=function(){
    __app("\u26A1 UPLOAD CHANNEL \u2014 OPEN. files are displayed in this session only.","yellow");
    __app("    max 10 MiB \u00B7 any type \u00B7 nothing leaves your browser","dim");
    __app("    choose or drop a file below \u2014 type <upload> to reopen anytime","dim");
    __open();
  };
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__init);else __init();
})();
