"use strict";(()=>{var a={};a.id=1566,a.ids=[1566],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},643:a=>{a.exports=require("node:perf_hooks")},1708:a=>{a.exports=require("node:process")},1932:a=>{a.exports=require("url")},4573:a=>{a.exports=require("node:buffer")},7066:a=>{a.exports=require("node:tty")},8128:a=>{a.exports=require("next/dist/server/runtime-reacts.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},14985:a=>{a.exports=require("dns")},16698:a=>{a.exports=require("node:async_hooks")},21820:a=>{a.exports=require("os")},27910:a=>{a.exports=require("stream")},28354:a=>{a.exports=require("util")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},31421:a=>{a.exports=require("node:child_process")},32467:a=>{a.exports=require("node:http2")},33873:a=>{a.exports=require("path")},34589:a=>{a.exports=require("node:assert")},37067:a=>{a.exports=require("node:http")},37540:a=>{a.exports=require("node:console")},38522:a=>{a.exports=require("node:zlib")},40610:a=>{a.exports=require("node:dns")},41692:a=>{a.exports=require("node:tls")},41792:a=>{a.exports=require("node:querystring")},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},46293:a=>{a.exports=require("sql.js")},48161:a=>{a.exports=require("node:os")},51455:a=>{a.exports=require("node:fs/promises")},53053:a=>{a.exports=require("node:diagnostics_channel")},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},57075:a=>{a.exports=require("node:stream")},57975:a=>{a.exports=require("node:util")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},69436:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>A,patchFetch:()=>z,routeModule:()=>v,serverHooks:()=>y,workAsyncStorage:()=>w,workUnitAsyncStorage:()=>x});var d=c(19225),e=c(84006),f=c(8317),g=c(99373),h=c(34775),i=c(24235),j=c(261),k=c(54365),l=c(90771),m=c(73461),n=c(67798),o=c(92280),p=c(62018),q=c(45696),r=c(47929),s=c(86439),t=c(10246),u=c(37527);let v=new d.AppRouteRouteModule({definition:{kind:e.RouteKind.APP_ROUTE,page:"/api/v1beta/models/[...path]/route",pathname:"/api/v1beta/models/[...path]",filename:"route",bundlePath:"app/api/v1beta/models/[...path]/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/app/src/app/api/v1beta/models/[...path]/route.js",nextConfigOutput:"standalone",userland:()=>c(75230),...{}}),{workAsyncStorage:w,workUnitAsyncStorage:x,serverHooks:y}=v;function z(){return(0,f.patchFetch)({workAsyncStorage:w,workUnitAsyncStorage:x})}async function A(a,b,c){c.requestMeta&&(0,g.setRequestMeta)(a,c.requestMeta),v.isDev&&(0,g.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let d="/api/v1beta/models/[...path]/route";"/index"===d&&(d="/");let f=await v.prepare(a,b,{srcPage:d,multiZoneDraftMode:!1});if(!f)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:w,deploymentId:x,params:y,nextConfig:z,parsedUrl:A,isDraftMode:B,prerenderManifest:C,routerServerContext:D,isOnDemandRevalidate:E,revalidateOnlyGenerated:F,resolvedPathname:G,clientReferenceManifest:H,serverActionsManifest:I,previewProps:J}=f,K=(0,j.normalizeAppPath)(d),L=!!C.routes[G]&&(v.isDev||(0,t.isRouteCacheOwner)(G,v.cacheOwner,C.routes[G])),M=!!(C.dynamicRoutes[K]||L),N=async()=>((null==D?void 0:D.render404)?await D.render404(a,b,A,!1):b.end("This page could not be found"),null);if(M&&!B){let a=C.dynamicRoutes[K];if(a&&!1===a.fallback&&!L){if(z.adapterPath)return await N();throw new s.NoFallbackError}}let O=null;!M||v.isDev||B||(O="/index"===(O=G)?"/":O),I&&H&&(0,i.setManifestsSingleton)({page:d,clientReferenceManifest:H,serverActionsManifest:I});let P=a.method||"GET",Q=(0,h.getTracer)(),R=Q.getActiveScopeSpan(),S=!!(null==D?void 0:D.isWrappedByNextServer),T=!!(0,g.getRequestMeta)(a,"minimalMode"),U=(0,g.getRequestMeta)(a,"incrementalCache")||await v.getIncrementalCache(a,z,J,C,T);null==U||U.resetRequestCache(),globalThis.__incrementalCache=U;let V={params:y,previewProps:J,renderOpts:{experimental:{authInterrupts:!!z.experimental.authInterrupts,useCacheTimeout:z.experimental.useCacheTimeout,durableUseCacheEntries:!!z.experimental.durableUseCacheEntries},cacheComponents:!!z.cacheComponents,validationLevel:z.experimental.instantInsights.validationLevel,isDraftMode:B,incrementalCache:U,hmrRefreshHash:(0,g.getRequestMeta)(a,"hmrRefreshHash"),cacheLifeProfiles:z.cacheLife,staticPageGenerationTimeout:z.staticPageGenerationTimeout,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0},sharedContext:{buildId:w,deploymentId:x}},W=new k.NodeNextRequest(a),X=new k.NodeNextResponse(b),Y=l.NextRequestAdapter.fromNodeNextRequest(W,(0,l.signalFromNodeResponse)(b)),Z=async({previousCacheEntry:e})=>{try{if(!T&&E&&F&&!e)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let d=null===O?await v.handle(Y,V):await v.prerender(Y,V);a.fetchMetrics=V.renderOpts.fetchMetrics;let f=V.renderOpts.pendingWaitUntil;f&&c.waitUntil&&(c.waitUntil(f),f=void 0);let g=V.renderOpts.collectedTags;if(!M)return await (0,o.I)(W,X,d,f),null;{let a=await d.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(d.headers);g&&(b[r.NEXT_CACHE_TAGS_HEADER]=g),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==V.renderOpts.collectedRevalidate&&!(V.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&V.renderOpts.collectedRevalidate,e=void 0===V.renderOpts.collectedExpire||V.renderOpts.collectedExpire>=r.INFINITE_CACHE?!1!==c&&c>0?z.expireTime:void 0:V.renderOpts.collectedExpire;return{value:{kind:u.CachedRouteKind.APP_ROUTE,status:d.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:e}}}}catch(b){throw(null==e?void 0:e.isStale)&&await v.onRequestError(a,b,{routerKind:"App Router",routePath:d,routeType:"route",revalidateReason:(0,n.getRevalidateReason)({isStaticGeneration:null!==O,isOnDemandRevalidate:E})},!1,D),b}},$=async(d,f)=>{try{var g,i;let d=await v.handleResponse({req:a,nextConfig:z,cacheKey:O,routeKind:e.RouteKind.APP_ROUTE,isFallback:!1,previewProps:J,prerenderManifest:C,isRoutePPREnabled:!1,isOnDemandRevalidate:E,revalidateOnlyGenerated:F,responseGenerator:Z,waitUntil:c.waitUntil,isMinimalMode:T});if(null!==d&&"error"in d)throw d.error;if(!M)return;if((null==d||null==(g=d.value)?void 0:g.kind)!==u.CachedRouteKind.APP_ROUTE)throw Error(`Invariant: app-route received invalid cache entry ${null==d||null==(i=d.value)?void 0:i.kind}`);T||b.setHeader("x-nextjs-cache",E?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),B&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let f=(0,p.fromNodeOutgoingHttpHeaders)(d.value.headers);T&&M||f.delete(r.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||b.getHeader("Cache-Control")||f.get("Cache-Control")||f.set("Cache-Control",(0,q.getCacheControlHeader)(d.cacheControl)),await (0,o.I)(W,X,new Response(d.value.body,{headers:f,status:d.value.status||200}));return}catch(c){if(c instanceof s.NoFallbackError||await v.onRequestError(a,c,{routerKind:"App Router",routePath:K,routeType:"route",revalidateReason:(0,n.getRevalidateReason)({isStaticGeneration:null!==O,isOnDemandRevalidate:E})},!1,D),M)throw c;if(b.headersSent){if(d){let a=c instanceof Error?c:Error("Unknown app route error");d.recordException(a),d.setStatus({code:h.SpanStatusCode.ERROR,message:a.message}),d.setAttribute("error.type",a.name)}b.writableEnded||b.destroyed||b.end()}else await (0,o.I)(W,X,new Response(null,{status:500}));return}finally{(()=>{if(!d)return;let a=b.statusCode;d.setAttributes({"http.status_code":a,"next.rsc":!1}),a&&a>=500&&(d.setStatus({code:h.SpanStatusCode.ERROR}),d.setAttribute("error.type",a.toString()));let c=Q.getRootSpanAttributes();if(!c)return;if(c.get("next.span_type")!==m.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${c.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=c.get("next.route")||K,g=`${P} ${e}`;d.setAttributes({"next.route":e,"http.route":e,"next.span_name":g}),d.updateName(g),f&&f!==d&&(f.setAttribute("http.route",e),f.updateName(g))})()}};if(S&&R)await $(R,void 0);else{let b=Q.getActiveScopeSpan();await Q.withPropagatedContext(a.headers,()=>Q.trace(m.BaseServerSpan.handleRequest,{spanName:`${P} ${d}`,kind:h.SpanKind.SERVER,attributes:{"http.method":P,"http.target":a.url}},a=>$(a,b)),void 0,!S)}}},71553:a=>{a.exports=require("node:dns/promises")},71622:a=>{a.exports=import("open")},72271:a=>{a.exports=require("@aws-sdk/credential-providers")},73024:a=>{a.exports=require("node:fs")},73136:a=>{a.exports=require("node:url")},73429:a=>{a.exports=require("node:util/types")},73496:a=>{a.exports=require("http2")},74075:a=>{a.exports=require("zlib")},75230:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.r(b),c.d(b,{OPTIONS:()=>n,POST:()=>o});var e=c(79489),f=c(80238),g=c(89718),h=c(81329),i=c(41004),j=c(88499),k=c(27811),l=a([e]);e=(l.then?(await l)():l)[0];let v=!1,w=/^[a-zA-Z0-9_.:-]+$/;async function m(){v||(await (0,j.Ai)(),v=!0)}async function n(){return new Response(null,{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"*"}})}async function o(a,{params:b}){await m();try{let f,g,{path:i}=await b;if(i.length>=2){let a=i[0],b=i[1];g=b.includes(":streamGenerateContent")?":streamGenerateContent":":generateContent";let c=b.replace(":streamGenerateContent","").replace(":generateContent","");f=a+"/"+c}else{let a=i[0];g=a.includes(":streamGenerateContent")?":streamGenerateContent":":generateContent",f=a.replace(":streamGenerateContent","").replace(":generateContent","")}let j=await a.json();if(function(a,b){let c,d=String(a||"");if(d.includes("/")&&!d.startsWith("gemini/")&&!d.startsWith("models/"))return!1;let e=p(a);return Array.isArray(c=b?.generationConfig?.responseModalities)&&c.some(a=>"AUDIO"===String(a).toUpperCase())||new Set([...(h.vq.gemini||[]).filter(a=>"tts"===(a.kind||a.type)).map(a=>a.id),...(h.vq["gemini-tts-models"]||[]).map(a=>a.id)]).has(e)}(f,j))return await t(a,j,f,g);let k=":streamGenerateContent"===g,l=function(a,b,c){function normalizeSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, key === "type" && typeof child === "string" ? child.toLowerCase() : normalizeSchema(child)
  ]));
}

function geminiPayloadToOpenAI(model, payload) {
  const messages = [];

  if (payload.systemInstruction?.parts) {
    const sysText = payload.systemInstruction.parts
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n");
    if (sysText) {
      messages.push({ role: "system", content: sysText });
    }
  }

  let callIdCounter = 1;
  const pendingCalls = [];

  if (Array.isArray(payload.contents)) {
    for (const c of payload.contents) {
      const parts = c.parts || [];
      if (c.role === "user") {
        const fnResponses = parts.filter((p) => p.functionResponse);
        if (fnResponses.length > 0) {
          for (const fr of fnResponses) {
            const toolCallId = fr.functionResponse.id || pendingCalls.shift() || `call_${callIdCounter++}`;
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              name: fr.functionResponse.name,
              content: JSON.stringify(fr.functionResponse.response?.result ?? fr.functionResponse.response ?? {})
            });
          }
        }

        const nonFnParts = parts.filter((p) => !p.functionResponse);
        if (nonFnParts.length > 0) {
          if (nonFnParts.some((p) => p.inlineData)) {
            const contentArray = [];
            for (const p of nonFnParts) {
              if (p.text) contentArray.push({ type: "text", text: p.text });
              if (p.inlineData) {
                contentArray.push({
                  type: "image_url",
                  image_url: {
                    url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
                  }
                });
              }
            }
            messages.push({ role: "user", content: contentArray });
          } else {
            const userText = nonFnParts.map((p) => p.text || "").join("\n").trim();
            if (userText) {
              messages.push({ role: "user", content: userText });
            }
          }
        }
      } else if (c.role === "model") {
        const fnCalls = parts.filter((p) => p.functionCall);
        const textParts = parts.filter((p) => p.text);
        const textContent = textParts.map((p) => p.text).join("\n").trim() || null;

        if (fnCalls.length > 0) {
          const toolCalls = fnCalls.map((fc, idx) => {
            const id = `call_${Date.now()}_${idx}_${callIdCounter++}`;
            pendingCalls.push(id);
            return {
              id,
              type: "function",
              function: {
                name: fc.functionCall.name,
                arguments: typeof fc.functionCall.args === "string"
                  ? fc.functionCall.args
                  : JSON.stringify(fc.functionCall.args || {})
              }
            };
          });
          messages.push({
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls
          });
        } else if (textContent) {
          messages.push({ role: "assistant", content: textContent });
        }
      }
    }
  }

  let tools;
  if (Array.isArray(payload.tools)) {
    const fnDecls = payload.tools.flatMap((t) => t.functionDeclarations || []);
    if (fnDecls.length > 0) {
      tools = fnDecls.map((fn) => ({
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: normalizeSchema(fn.parameters || { type: "object", properties: {} })
        }
      }));
    }
  }

  let tool_choice;
  const mode = payload.toolConfig?.functionCallingConfig?.mode;
  if (mode === "NONE") tool_choice = "none";
  else if (mode === "ANY" || mode === "REQUIRED") tool_choice = "required";
  else if (mode === "AUTO") tool_choice = "auto";

  return {
    model,
    messages,
    stream: false,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {})
  };
}

const result=geminiPayloadToOpenAI(b,a);return {...result,stream:c,max_tokens:a.generationConfig?.maxOutputTokens,temperature:a.generationConfig?.temperature,top_p:a.generationConfig?.topP}}(j,f,k),m=new Request(a.url,{method:"POST",headers:a.headers,body:JSON.stringify(l)}),n=await (0,e.P)(m);if(k){var c=n,d=f;if(!c.ok||!c.body)return c;let a=new TextDecoder,b=new TextEncoder,e=new TransformStream({transform(c,e){for(let f of a.decode(c,{stream:!0}).split("\n")){let a;if(!f.startsWith("data:"))continue;let c=f.slice(5).trim();if(!c||"[DONE]"===c)continue;try{a=JSON.parse(c)}catch{continue}let g=a.choices?.[0];if(!g)continue;let h=g.delta||{},i=[];if(h.reasoning_content&&i.push({text:h.reasoning_content,thought:!0}),h.content&&i.push({text:h.content}),0===i.length&&!g.finish_reason)continue;let j={content:{role:"model",parts:i.length>0?i:[{text:""}]},index:0};g.finish_reason&&(j.finishReason=x[g.finish_reason]||"STOP");let k={candidates:[j]};if(g.finish_reason&&a.usage){k.usageMetadata={promptTokenCount:a.usage.prompt_tokens||0,candidatesTokenCount:a.usage.completion_tokens||0,totalTokenCount:a.usage.total_tokens||0};let b=a.usage.completion_tokens_details?.reasoning_tokens;b&&(k.usageMetadata.thoughtsTokenCount=b),k.modelVersion=a.model||d}e.enqueue(b.encode("data: "+JSON.stringify(k)+"\r\n\r\n"))}}});return new Response(c.body.pipeThrough(e),{status:200,headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Access-Control-Allow-Origin":"*"}})}return await u(n,f)}catch(a){return console.log("Error handling Gemini request:",a),Response.json({error:{message:a.message,code:500}},{status:500})}}function p(a){return String(a||"").replace(/^models\//,"").replace(/^gemini\//,"")}async function q(a){if(!(await (0,g.mt)()).requireApiKey)return null;let b=function(a){let b=a.headers.get("Authorization");if(b?.startsWith("Bearer "))return b.slice(7);let c=a.headers.get("x-goog-api-key");return c||new URL(a.url).searchParams.get("key")}(a);return b?await (0,f.kI)(b)?null:Response.json({error:{message:"Invalid API key"}},{status:401}):Response.json({error:{message:"Missing API key"}},{status:401})}function r(a){let b=new Headers(a.headers);return b.delete("content-encoding"),b.delete("content-length"),b.delete("transfer-encoding"),b.set("Access-Control-Allow-Origin","*"),b}function s(a){return a?.cause?.code||a?.code||a?.cause?.name||a?.name||"UNKNOWN"}async function t(a,b,c,d){let e=await q(a);if(e)return e;let g=p(c);if(!w.test(g))return Response.json({error:{message:"Invalid model"}},{status:400});let h=await (0,k.QU)(await (0,k.TM)(a),c,"gemini",g);if(h)return h;let j=new Set,l=JSON.stringify(b),m=null,n=null;for(;;){let b,c=await (0,f.c1)("gemini",j,g);if(!c||c.allRateLimited)return console.log(`[GEMINI_NATIVE] exhausted model=${g} status=${n||Number(c?.lastErrorCode)||503} error=${m||c?.lastError||"No active credentials for provider: gemini"}`),Response.json({error:{message:m||c?.lastError||"No active credentials for provider: gemini"}},{status:n||Number(c?.lastErrorCode)||503});let e=c?.apiKey?{"x-goog-api-key":c.apiKey}:c?.accessToken?{Authorization:`Bearer ${c.accessToken}`}:null;if(!e)return Response.json({error:{message:"No Gemini API key configured"}},{status:404});let h=function(a){let b=String(a?.connectionId||"unknown").slice(0,8),c=String(a?.connectionName||"");return!c||c.includes("@")?b:`${c}:${b}`}(c),k=Date.now(),o=function(a,b,c){let d=new URL(a),e=new URL(`https://generativelanguage.googleapis.com/v1beta/models/${p(b)}${c}`);for(let[a,b]of d.searchParams.entries())"key"!==a&&e.searchParams.append(a,b);return e.toString()}(a.url,g,d),q=new AbortController,t=!1,u=setTimeout(()=>{t=!0,q.abort()},i.IK),v=()=>q.abort();if(a.signal?.aborted)return console.log(`[GEMINI_NATIVE] client aborted model=${g} ms=0 conn=${h}`),Response.json({error:{message:"Client closed request"}},{status:499});a.signal?.addEventListener("abort",v,{once:!0}),console.log(`[GEMINI_NATIVE] start model=${g} action=${d} conn=${h} body=${Buffer.byteLength(l)}B timeout=${i.IK}`);try{b=await fetch(o,{method:"POST",headers:{"Content-Type":a.headers.get("Content-Type")||"application/json",...e},body:l,signal:q.signal})}catch(l){let b=Date.now()-k;if(a.signal?.aborted&&!t)return console.log(`[GEMINI_NATIVE] client aborted model=${g} ms=${b} conn=${h}`),Response.json({error:{message:"Client closed request"}},{status:499});let d=!function(a,b){if(b)return!0;let c=s(a);return"UND_ERR_HEADERS_TIMEOUT"===c||"HeadersTimeoutError"===c}(l,t)?502:504,e=function(a){let b=a?.message||String(a),c=s(a);return`${b} (${c})`}(l);console.log(`[GEMINI_NATIVE] fetch failed model=${g} status=${d} ms=${b} conn=${h} error=${e}`);let{shouldFallback:i}=await (0,f.vk)(c.connectionId,d,e,"gemini",g);if(i){j.add(c.connectionId),m=e,n=d,console.log(`[GEMINI_NATIVE] fallback model=${g} status=${d} conn=${h} exclude=${j.size}`);continue}return Response.json({error:{message:e}},{status:d})}finally{clearTimeout(u),a.signal?.removeEventListener("abort",v)}if(console.log(`[GEMINI_NATIVE] upstream model=${g} status=${b.status} ms=${Date.now()-k} conn=${h} ct=${b.headers.get("content-type")||"?"} cl=${b.headers.get("content-length")||"?"}`),b.ok)return await (0,f.Pt)(c.connectionId,c,g),new Response(b.body,{status:b.status,statusText:b.statusText,headers:r(b)});let w=await b.text(),{shouldFallback:x}=await (0,f.vk)(c.connectionId,b.status,w,"gemini",g);if(x){j.add(c.connectionId),m=w,n=b.status;continue}return new Response(w,{status:b.status,statusText:b.statusText,headers:r(b)})}}let x={stop:"STOP",length:"MAX_TOKENS",tool_calls:"STOP",content_filter:"SAFETY"};async function u(a,b){let c;if(!a.ok)return a;try{c=await a.json()}catch{return a}if(c.candidates)return Response.json(c,{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});if(c.error)return Response.json(c,{status:a.status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});let d=c.choices?.[0];if(!d)return Response.json(c,{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});let{message:e,finish_reason:f}=d,g=[];e.reasoning_content&&g.push({text:e.reasoning_content,thought:!0});if(Array.isArray(e.tool_calls)){for(const tc of e.tool_calls){let args={};try{args=typeof tc.function?.arguments==="string"?JSON.parse(tc.function.arguments):(tc.function?.arguments||{})}catch{}g.push({functionCall:{name:tc.function?.name,args}})}}if(e.content)g.push({text:e.content});let h={candidates:[{content:{role:"model",parts:g},finishReason:x[f]||"STOP",index:0}],modelVersion:c.model||b};if(c.usage){h.usageMetadata={promptTokenCount:c.usage.prompt_tokens||0,candidatesTokenCount:c.usage.completion_tokens||0,totalTokenCount:c.usage.total_tokens||0};let a=c.usage.completion_tokens_details?.reasoning_tokens;a&&(h.usageMetadata.thoughtsTokenCount=a)}return Response.json(h,{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}})}d()}catch(a){d(a)}})},75919:a=>{a.exports=require("node:worker_threads")},76760:a=>{a.exports=require("node:path")},77030:a=>{a.exports=require("node:net")},77598:a=>{a.exports=require("node:crypto")},78474:a=>{a.exports=require("node:events")},79646:a=>{a.exports=require("child_process")},80099:a=>{a.exports=require("node:sqlite")},81329:(a,b,c)=>{c.d(b,{CP:()=>f,Xg:()=>d.Xg,bs:()=>g,eh:()=>e,vq:()=>d.PROVIDER_MODELS,zc:()=>i});var d=c(57247);new Set(Object.entries(c(40615).AI_PROVIDERS).filter(([,a])=>a.passthroughModels).map(([a])=>a));let e=Object.entries(d.PROVIDER_MODELS).flatMap(([a,b])=>b.map(b=>({provider:a,model:b.id,name:b.name}))),f=(a,b=null)=>a?.kind||a?.type||b,g={vision:{icon:"visibility",label:"Vision",desc:"Supports image input",color:"text-blue-500"},reasoning:{icon:"neurology",label:"Reasoning",desc:"Supports reasoning / thinking",color:"text-amber-500"}},h={"gemini-live":{label:"Gemini Live (realtime WebSocket)",desc:"Streams audio over bidiGenerateContent and returns incremental transcription segments"}};function i(a){return"string"==typeof a&&Object.prototype.hasOwnProperty.call(h,a.trim())}Object.freeze(Object.keys(h))},81630:a=>{a.exports=require("http")},81787:a=>{a.exports=require("bun:sqlite")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},87550:a=>{a.exports=require("better-sqlite3")},87997:a=>{a.exports=require("node:timers")},91645:a=>{a.exports=require("net")},94735:a=>{a.exports=require("events")}};var b=require("../../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[2970,7774,5182,9100,1892,6070,8920,436,24,3943,2578,3225,6922,5215,9696,7552,8499,6249,8416,5330,9604,7828,8895,238,8910,8635],()=>b(b.s=69436));module.exports=c})();