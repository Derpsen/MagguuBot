import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText } from '../src/utils/html.js';

test('decodes double-escaped entities only once', () => {
  assert.equal(htmlToText('a &amp;lt; b'), 'a &lt; b');
});
test('escaped script tag becomes literal text', () => {
  assert.equal(htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
});
test('strips nested and malformed tags', () => {
  assert.equal(htmlToText('<div><b>x<i>y</i></b></div>'), 'xy');
  assert.equal(htmlToText('<scr<script>ipt>z'), 'ipt>z');
});
test('br/p become newlines, nbsp and quotes decoded', () => {
  assert.equal(htmlToText('<p>a&nbsp;b</p><p>&quot;c&#39;</p>x<br/>y'), 'a b\n"c\'\nx\ny');
  assert.equal(htmlToText('<p>a</p>\n\n\n<p>b</p>'), 'a\n\nb');
});
