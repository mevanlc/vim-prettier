let s:prettier_jobs = {}

function! prettier#job#async#vim#run(cmd, startSelection, endSelection, ...) abort
  let l:bufnr = bufnr('%')
  if has_key(s:prettier_jobs, l:bufnr)
    return
  endif

  let l:write = a:0 > 0 ? a:1 : 0
  let l:changedtick = b:changedtick
  let s:prettier_jobs[l:bufnr] = 1

  let l:cmd = type(a:cmd) == type([]) ? a:cmd : [&shell, &shellcmdflag, a:cmd]
  let l:job = job_start(l:cmd, {
    \ 'out_io': 'buffer',
    \ 'err_cb': {channel, msg -> s:onError(msg, l:bufnr)},
    \ 'close_cb': {channel -> s:onClose(channel, a:startSelection, a:endSelection, l:bufnr, l:changedtick, l:write)}})

  let l:stdin = job_getchannel(l:job)

  call ch_sendraw(l:stdin, join(getbufline(l:bufnr, a:startSelection, a:endSelection), "\n"))
  call ch_close_in(l:stdin)
endfunction

function! s:reset(bufnr) abort
  if has_key(s:prettier_jobs, a:bufnr)
    call remove(s:prettier_jobs, a:bufnr)
  endif
endfunction

function! s:onError(msg, bufnr) abort
  try
    call prettier#job#runner#onError(split(a:msg, '\n'))
  finally
    call s:reset(a:bufnr)
  endtry
endfunction

function! s:onClose(channel, startSelection, endSelection, bufnr, changedtick, write) abort
  let l:currentBufferNumber = bufnr('%')
  let l:isInsideAnotherBuffer = a:bufnr != l:currentBufferNumber ? 1 : 0

  let l:buff = ch_getbufnr(a:channel, 'out')
  let l:out = getbufline(l:buff, 2, '$')
  execute 'bd!' . l:buff

  " we have no prettier output so lets exit
  if len(l:out) == 0
    call s:reset(a:bufnr)
    return
  endif

  if !bufloaded(a:bufnr) || getbufvar(a:bufnr, 'changedtick') != a:changedtick
    call s:reset(a:bufnr)
    return
  endif

  " nothing to update
  if l:isInsideAnotherBuffer == 0 && (prettier#utils#buffer#willUpdatedLinesChangeBuffer(l:out, a:startSelection, a:endSelection) == 0)
    call s:reset(a:bufnr)
    redraw!
    return
  endif

  " This is required due to race condition when user quickly switch buffers while the async
  " cli has not finished running, vim 8.0.1039 has introduced setbufline() which can be used
  " to fix this issue in a cleaner way, however since we still need to support older vim versions
  " we will apply a more generic solution
  if l:isInsideAnotherBuffer
    try
      silent exec 'sp ' . fnameescape(bufname(a:bufnr))
      if prettier#utils#buffer#willUpdatedLinesChangeBuffer(l:out, a:startSelection, a:endSelection)
        call prettier#utils#buffer#replaceAndMaybeSave(l:out, a:startSelection, a:endSelection, a:write)
      endif
    catch
      call prettier#logging#error#log('PARSING_ERROR', bufname(a:bufnr))
    finally
      " we should then hide this buffer again
      if a:bufnr == bufnr('%')
        silent hide
      endif
    endtry
  else
    try
      call prettier#utils#buffer#replaceAndMaybeSave(l:out, a:startSelection, a:endSelection, a:write)
    catch
      call prettier#logging#error#log('PARSING_ERROR', bufname(a:bufnr))
    endtry
  endif
  call s:reset(a:bufnr)
endfunction
