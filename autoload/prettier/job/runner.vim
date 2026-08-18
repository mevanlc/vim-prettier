" TODO
" move the bellow vim checks to UTILS
let s:isLegacyVim = v:version < 800
let s:isNeoVim = has('nvim')
let s:isAsyncVim = !s:isLegacyVim && exists('*job_start')

function! prettier#job#runner#run(cmd, startSelection, endSelection, async, ...) abort
    let l:write = a:0 > 0 ? a:1 : 0
    if a:async && (s:isAsyncVim || s:isNeoVim)
      call s:asyncFormat(a:cmd, a:startSelection, a:endSelection, l:write)
    else
      call s:format(a:cmd, a:startSelection, a:endSelection)
    endif
endfunction

function! prettier#job#runner#onError(errors) abort
  let l:shortMessage = join(a:errors, "\n")
  let l:shortMessage = strpart(l:shortMessage, 0, 120)
  call prettier#logging#error#log('PARSING_ERROR', l:shortMessage)
  if g:prettier#quickfix_enabled
    call prettier#bridge#parser#onError(a:errors, g:prettier#quickfix_auto_focus)
  endif
endfunction

function! s:asyncFormat(cmd, startSelection, endSelection, write) abort
    if !s:isAsyncVim && !s:isNeoVim 
      call s:format(a:cmd, a:startSelection, a:endSelection)
    endif 

    let l:cmd = s:job_command(a:cmd)

    if s:isAsyncVim
      call prettier#job#async#vim#run(l:cmd, a:startSelection, a:endSelection, a:write)
    else
      call prettier#job#async#neovim#run(l:cmd, a:startSelection, a:endSelection, a:write)
    endif
endfunction

function! s:format(cmd, startSelection, endSelection) abort
  let l:bufferLinesList = getbufline(bufnr('%'), a:startSelection, a:endSelection)

  " vim 7 does not have support for passing a list to system()
  let l:bufferLines = s:isLegacyVim ? join(l:bufferLinesList, "\n") : l:bufferLinesList

  " TODO
  " since we are using two different types for system, maybe we should move it to utils shims
  let l:out = split(system(s:system_command(a:cmd), l:bufferLines), '\n')

  " check system exit code
  if v:shell_error
    call prettier#job#runner#onError(l:out)
    return
  endif

  " TODO
  " doing 0 checks seems weird can we do this bellow differently ?
  if (prettier#utils#buffer#willUpdatedLinesChangeBuffer(l:out, a:startSelection, a:endSelection) == 0)
    return
  endif

  call prettier#utils#buffer#replace(l:out, a:startSelection, a:endSelection)
endfunction

function! s:system_command(cmd) abort
  if type(a:cmd) == type({})
    return a:cmd.shell
  endif

  return a:cmd
endfunction

function! s:job_command(cmd) abort
  if type(a:cmd) == type({})
    return a:cmd.argv
  endif

  if has('win32') || has('win64')
    return 'cmd.exe /c ' . a:cmd
  endif

  return a:cmd
endfunction
