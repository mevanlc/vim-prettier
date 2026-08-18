let s:prettier_jobs = {}

function! prettier#job#async#neovim#run(cmd, startSelection, endSelection, ...) abort
  let l:bufnr = bufnr('%')
  if has_key(s:prettier_jobs, l:bufnr)
    return
  endif
  let s:prettier_jobs[l:bufnr] = 1

  let l:lines = getline(a:startSelection, a:endSelection)
  let l:dict = {
        \ 'start': a:startSelection - 1,
        \ 'end': a:endSelection,
        \ 'buf_nr': l:bufnr,
        \ 'changedtick': b:changedtick,
        \ 'write': a:0 > 0 ? a:1 : 0,
        \ 'content': l:lines,
        \}
  let l:out = []
  let l:err = []

  let l:cmd = type(a:cmd) == type([]) ? a:cmd : [&shell, &shellcmdflag, a:cmd]
  let l:job = jobstart(l:cmd, {
    \ 'stdout_buffered': 1,
    \ 'stderr_buffered': 1,
    \ 'on_stdout': {job_id, data, event -> extend(l:out, data)},
    \ 'on_stderr': {job_id, data, event -> extend(l:err, data)},
    \ 'on_exit': {job_id, status, event -> s:onExit(status, l:dict, l:out, l:err)},
    \ })
  call jobsend(l:job, l:lines)
  call jobclose(l:job, 'stdin')
endfunction

function! s:reset(bufnr) abort
  if has_key(s:prettier_jobs, a:bufnr)
    call remove(s:prettier_jobs, a:bufnr)
  endif
endfunction

function! s:onExit(status, info, out, err) abort
  if len(a:out) == 0
    call s:reset(a:info.buf_nr)
    return
  endif

  let l:currentBufferNumber =  bufnr('%')
  let l:isInsideAnotherBuffer = a:info.buf_nr != l:currentBufferNumber ? 1 : 0
  let l:last = a:out[len(a:out) - 1]
  let l:out = l:last ==? '' ? a:out[0:len(a:out) - 2] : a:out

  " parsing errors
  if a:status != 0
    try
      call prettier#job#runner#onError(a:err)
    finally
      call s:reset(a:info.buf_nr)
    endtry
    return
  endif

  " we have no prettier output so lets exit
  if len(l:out) == 0
    call s:reset(a:info.buf_nr)
    return
  endif

  if !bufloaded(a:info.buf_nr) || getbufvar(a:info.buf_nr, 'changedtick') != a:info.changedtick
    call s:reset(a:info.buf_nr)
    return
  endif

  " nothing to update
  if l:isInsideAnotherBuffer == 0 && (prettier#utils#buffer#willUpdatedLinesChangeBuffer(l:out, a:info.start, a:info.end) == 0)
    call s:reset(a:info.buf_nr)
    redraw!
    return
  endif

  " This is required due to race condition when user quickly switch buffers while the async
  " cli has not finished running, vim 8.0.1039 has introduced setbufline() which can be used
  " to fix this issue in a cleaner way, however since we still need to support older vim versions
  " we will apply a more generic solution
  if l:isInsideAnotherBuffer
    try
      silent exec 'sp '. fnameescape(bufname(a:info.buf_nr))
      if prettier#utils#buffer#willUpdatedLinesChangeBuffer(l:out, a:info.start, a:info.end)
        call prettier#utils#buffer#replaceAndMaybeSave(l:out, a:info.start, a:info.end, a:info.write)
      endif
    catch
      call prettier#logging#error#log('PARSING_ERROR')
    finally
      " we should then hide this buffer again
      if a:info.buf_nr == bufnr('%')
        silent hide
      endif
    endtry
  else
    try
      call prettier#utils#buffer#replaceAndMaybeSave(l:out, a:info.start, a:info.end, a:info.write)
    catch
      call prettier#logging#error#log('PARSING_ERROR')
    endtry
  endif
  call s:reset(a:info.buf_nr)
endfunction
