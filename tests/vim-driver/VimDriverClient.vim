let g:vim_driver_client_id = 'undefined'
let g:vim_driver_client_buffer = ''

function! s:info(message) abort
  echohl MoreMsg | echom 'vim-driver: ' . a:message | echohl
endfunction

function! s:warn(message) abort
  echohl WarningMsg | echom 'vim-driver: ' . a:message | echohl
endfunction

function! s:send(channel, raw_message) abort
  if has('nvim')
    call chansend(a:channel, a:raw_message)
  else
    call ch_sendraw(a:channel, a:raw_message)
  endif
endfunction

function! g:VimDriverClient#open(host, port) abort
  try
    if !has('nvim') && has('channel') !=# 1
      call s:warn('channel not supported')
      return
    endif

    if exists('g:vim_driver_client_channel')
      call s:warn('client already open')
      return
    endif

    let l:address = a:host . ':' . a:port
    if has('nvim')
      let l:channel = sockconnect('tcp', l:address, {
            \ 'mode': 'nl',
            \ 'on_data': 'VimDriverClient#__onNvimData'})
    else
      let l:channel_opts = {
            \ 'mode': 'nl',
            \ 'callback': 'VimDriverClient#__onMessage',
            \ 'close_cb': 'VimDriverClient#__onClose'}

      if v:version >= 800
        let l:channel_opts.drop = 'never'
      endif

      let l:channel = ch_open(l:address, l:channel_opts)
    endif
    let g:vim_driver_client_channel = l:channel

    if has('nvim') ? l:channel <= 0 : ch_status(l:channel) !=# 'open'
      call s:warn('failed to open channel')
      unlet g:vim_driver_client_channel
    else
      call s:info('opened channel on ' . a:host . ':' . a:port)
      call s:send(l:channel, json_encode(['$id', {'id': g:vim_driver_client_id}]) . "\n")
    endif
  catch
    call s:warn('failed to open channel: ' . v:exception)
  endtry
endfunction

function! g:VimDriverClient#close() abort
  try
    if exists('g:vim_driver_client_channel')
      if !has('nvim') && ch_status(g:vim_driver_client_channel) !=# 'open'
        unlet g:vim_driver_client_channel
        return
      endif

      if has('nvim')
        call chanclose(g:vim_driver_client_channel)
      else
        call ch_close(g:vim_driver_client_channel)
      endif
      unlet g:vim_driver_client_channel
      call s:info('closed channel')
    else
      call s:warn('channel already closed')
    endif
  catch
    call s:warn('failed to close channel')
  endtry
endfunction

function! g:VimDriverClient#__onNvimData(channel, data, event) abort
  for l:raw_message in a:data
    if l:raw_message !=# ''
      call VimDriverClient#__onMessage(a:channel, l:raw_message)
    endif
  endfor
endfunction

function! g:VimDriverClient#__onMessage(channel, raw_message) abort
  try
    let l:message = json_decode(a:raw_message)
    let l:id = l:message[0]
    let l:payload = l:message[1]
    let l:type = l:payload.type

    if l:type ==# 'command:call'
      call s:onCall(a:channel, l:id, l:payload)
    elseif l:type ==# 'command:edit'
      call s:onEdit(a:channel, l:id, l:payload)
    elseif l:type ==# 'command:eval'
      call s:onEval(a:channel, l:id, l:payload)
    elseif l:type ==# 'command:execute'
      call s:onExecute(a:channel, l:id, l:payload)
    elseif l:type ==# 'whois'
      call s:onWhoIs(a:channel, l:id, l:payload)
    endif
  catch
    call s:warn(v:exception)
    call s:send(a:channel, json_encode([l:id, {'error': v:exception}]) . "\n")
  endtry
endfunction

function! g:VimDriverClient#__onClose(channel) abort
  call s:info('client closed remotely')
  call VimDriverClient#close()
endfunction

function! s:escape(string) abort
  return eval('"' . a:string . '"')
endfunction

function! s:onCall(channel, id, payload) abort
  let l:name = a:payload.name
  let l:arglist = a:payload.arglist
  let l:result = call(l:name, map(l:arglist, {_key, val -> s:escape(val)}))
  call s:send(a:channel, json_encode([a:id, {'result': l:result}]) . "\n")
endfunction

function! s:onEdit(channel, id, payload) abort
  call execute('edit ' . a:payload.path)
  call s:send(a:channel, json_encode([a:id, {}]) . "\n")
endfunction

function! s:onEval(channel, id, payload) abort
  let l:result = eval(a:payload.string)
  call s:send(a:channel, json_encode([a:id, {'result': l:result}]) . "\n")
endfunction

function! s:onExecute(channel, id, payload) abort
  let l:result = execute(s:escape(a:payload.command))
  let l:result = substitute(l:result, "^\n", '', '')
  call s:send(a:channel, json_encode([a:id, {'result': l:result}]) . "\n")
endfunction

function! s:onWhoIs(channel, id, _payload) abort
  call s:send(a:channel, json_encode([a:id, {'id': g:vim_driver_client_id}]) . "\n")
endfunction
