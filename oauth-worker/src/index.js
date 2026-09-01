export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      const callback = `${url.origin}/callback`;
      const github = new URL("https://github.com/login/oauth/authorize");
      github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      github.searchParams.set("redirect_uri", callback);
      github.searchParams.set("scope", "repo");
      return Response.redirect(github.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });

      const data = await tokenResp.json();
      if (!data.access_token) {
        return new Response(JSON.stringify(data), { status: 400, headers: {"content-type":"application/json"} });
      }

      const payload = {
        token: data.access_token,
        provider: "github"
      };

      // 标准 Decap/Netlify CMS 握手协议：
      // 1. 弹窗先向主窗口发 "authorizing:github" 表示就绪
      // 2. CMS 回发 "authorizing:github"，弹窗收到后才交付 token
      // 3. 2 秒未收到回应则直接投递（兼容旧版行为）
      const html = `<!doctype html><html><body><script>
        (function() {
          var payload = ${JSON.stringify(payload)};
          var done = false;
          function sendToken(origin) {
            if (done) return;
            done = true;
            window.opener.postMessage(
              'authorization:github:success:' + JSON.stringify(payload),
              origin || '*'
            );
            window.close();
          }
          window.addEventListener('message', function(e) {
            if (e.data === 'authorizing:github') sendToken(e.origin);
          }, false);
          window.opener.postMessage('authorizing:github', '*');
          setTimeout(function() { sendToken('*'); }, 2000);
        })();
      <\/script></body></html>`;

      return new Response(html, { headers: {"content-type":"text/html;charset=UTF-8"} });
    }

    return new Response("Not Found", { status: 404 });
  }
};
