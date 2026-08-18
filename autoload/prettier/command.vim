function! prettier#command#build(execCmd, config, hasSelection, start, end) abort
  let l:args = prettier#resolver#config#resolve_args(
        \ a:config,
        \ a:hasSelection,
        \ a:start,
        \ a:end)

  return {
        \ 'shell': shellescape(a:execCmd) . prettier#resolver#config#resolve(
        \   a:config,
        \   a:hasSelection,
        \   a:start,
        \   a:end),
        \ 'argv': [a:execCmd] + l:args,
        \ }
endfunction
